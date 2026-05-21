import fs from 'node:fs';
import { BootstrapError, runBootstrapCommand } from './bootstrap.mjs';
import { EvalHandoffError, printEvalHandoffUsage, printEvalUsage, runEvalCommand } from './eval-handoff.mjs';
import { EventError, printEventCheckUsage, printEventPromoteUsage, printEventUsage, runEventCommand } from './event.mjs';
import { RouteError, printRouteUsage, runRouteCommand } from './route.mjs';
import { SetupError, runSetupCommand } from './setup.mjs';
import { ProposalError, printProposalCommandUsage, printProposalUsage, runProposalCommand } from './proposal.mjs';
import { PromoteError, printPromoteCheckUsage, printPromotePlanUsage, printPromoteUsage, runPromoteCommand } from './promote.mjs';
import { SkillManagerError, runSkillCommand } from './skill-manager.mjs';


const TOP_USAGE = `Usage: noesis <command> [args]

Commands:
  init                          Create Noesis-owned bootstrap state.
  setup                         One-step HS workspace bootstrap.
  doctor                        Check Noesis manifest and component readiness.
  config show                   Show the Noesis bootstrap manifest.
  event                         Check learning-event artifacts.
  route                         Orchestrate event-to-proposal routing.
  promote                       Check promote-request artifacts.
  proposal                      Review proposal queue artifacts.
  eval                          Handoff approved eval proposals to eval owner flow.
  skill                         Manage agent skill visibility and capabilities.
  help [command]                Show command help.

Options:
  -h, --help                    Show this help message.
  --version                     Show package version.

Examples:
  noesis init --workspace /path/to/workspace --with pamem,loreforge
  noesis setup --workspace /path/to/workspace --component pamem=/path/to/pamem --component loreforge=/path/to/LoreForge
  noesis doctor --workspace /path/to/workspace
  noesis config show --workspace /path/to/workspace
  noesis event check .noesis/events/example.json
  noesis event promote .noesis/events/example.json
  noesis route .noesis/events/example.json
  noesis promote check .noesis/promote-requests/example.json
  noesis proposal list --workspace /path/to/workspace
  noesis proposal summary --workspace /path/to/workspace
  noesis eval handoff .noesis/proposals/example.json
  noesis skill list
  noesis skill add planning-with-files --workspace /path/to/workspace
  noesis skill add humanize
  noesis skill add pamem --runtime codex
  noesis help skill add`;

const SKILL_USAGE = `Usage: noesis skill <command> [args]

Commands:
  list                          List visible skills and capabilities.
  inspect <name>                Inspect one skill.
  verify [name]                 Verify visible skill links.
  add <name>                    Add a skill or capability.
  remove <name>                 Remove skill visibility or a capability.
  help [command]                Show skill command help.

Target options:
  --workspace <path>            Workspace root to manage. Defaults to the current directory.
  --agent-id <id>               Resolve a pamem agent workspace via 'pamem status --json'.
  --global                      Manage global ~/.codex/skills and ~/.claude/skills visibility.
  --json                        Print machine-readable JSON.

Source options:
  --source <path>               Explicit local skill directory containing SKILL.md.
  --alias <name>                Link name for 'add'. Defaults to the source basename.

Runtime options:
  --runtime <codex|claude|both> Runtime to use for pamem add/remove.

Examples:
  noesis skill list --agent-id coder-local
  noesis skill inspect planning-with-files --json
  noesis skill verify
  noesis skill add planning-with-files --alias planner
  noesis skill add pamem --runtime codex
  noesis skill remove planner

Use "noesis skill <command> --help" for command-specific options.`;

const SKILL_COMMAND_USAGE = {
  list: `Usage: noesis skill list [target-options] [--json]

List skills visible through .codex/skills and .claude/skills, plus known
plugin and runtime capabilities.

Target options:
  --workspace <path>            Workspace root to manage. Defaults to the current directory.
  --agent-id <id>               Resolve a pamem agent workspace via 'pamem status --json'.
  --global                      Manage global ~/.codex/skills and ~/.claude/skills visibility.

Output options:
  --json                        Print machine-readable JSON.

Examples:
  noesis skill list
  noesis skill list --workspace /path/to/workspace
  noesis skill list --agent-id coder-local --json`,

  inspect: `Usage: noesis skill inspect <name> [target-options] [source-options] [--json]

Inspect one skill source, plugin capability, or runtime capability.

Target options:
  --workspace <path>            Workspace root to manage. Defaults to the current directory.
  --agent-id <id>               Resolve a pamem agent workspace via 'pamem status --json'.
  --global                      Manage global ~/.codex/skills and ~/.claude/skills visibility.

Source options:
  --source <path>               Explicit local skill directory containing SKILL.md.

Output options:
  --json                        Print machine-readable JSON.

Examples:
  noesis skill inspect planning-with-files
  noesis skill inspect planning-with-files --source ~/skills/planning-with-files
  noesis skill inspect planning-with-files --json`,

  verify: `Usage: noesis skill verify [name] [target-options] [source-options] [--json]

Verify visible skill links and known capabilities. With a skill name, also
verifies the resolved source.
Exits 0 when verification passes and 1 when any checked skill fails.

Target options:
  --workspace <path>            Workspace root to manage. Defaults to the current directory.
  --agent-id <id>               Resolve a pamem agent workspace via 'pamem status --json'.
  --global                      Manage global ~/.codex/skills and ~/.claude/skills visibility.

Source options:
  --source <path>               Explicit local skill directory containing SKILL.md.

Output options:
  --json                        Print machine-readable JSON.

Examples:
  noesis skill verify
  noesis skill verify planning-with-files
  noesis skill verify planning-with-files --source ~/skills/planning-with-files --json`,

  add: `Usage: noesis skill add <name> [target-options] [source-options] [--json]

Add a symlink skill in both .codex/skills and .claude/skills, or add a known
plugin/runtime capability. Managed sources under this package's skills/ are
preferred; ~/skills remains supported as an external compatibility source.

Target options:
  --workspace <path>            Workspace root to manage. Defaults to the current directory.
  --agent-id <id>               Resolve a pamem agent workspace via 'pamem status --json'.
  --global                      Manage global ~/.codex/skills and ~/.claude/skills visibility.

Source options:
  --source <path>               Explicit local skill directory containing SKILL.md.
  --alias <name>                Link name to create. Defaults to the source basename.

Runtime options:
  --runtime <codex|claude|both> Runtime to use when adding pamem. Defaults to inferred target state.

Output options:
  --json                        Print machine-readable JSON.

Examples:
  noesis skill add planning-with-files
  noesis skill add planning-with-files --workspace /path/to/workspace
  noesis skill add planning-with-files --alias planner
  noesis skill add humanize
  noesis skill add pamem --runtime codex`,

  remove: `Usage: noesis skill remove <name> [target-options] [--json]

Remove visible skill symlinks from both .codex/skills and .claude/skills, or
remove a known plugin/runtime capability. The source skill directory is never
deleted.

Target options:
  --workspace <path>            Workspace root to manage. Defaults to the current directory.
  --agent-id <id>               Resolve a pamem agent workspace via 'pamem status --json'.
  --global                      Manage global ~/.codex/skills and ~/.claude/skills visibility.

Runtime options:
  --runtime <codex|claude|both> Runtime to use when removing pamem. Defaults to inferred target state.

Output options:
  --json                        Print machine-readable JSON.

Examples:
  noesis skill remove planning-with-files
  noesis skill remove planner --workspace /path/to/workspace
  noesis skill remove planning-with-files --global
  noesis skill remove pamem --runtime codex`,
};


class UsageError extends Error {}


export function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
      printTopUsage();
      return 0;
    }
    if (argv[0] === '--version') {
      console.log(packageVersion());
      return 0;
    }
    if (argv[0] === 'help') {
      return printHelp(argv.slice(1));
    }

    const [command, ...rest] = argv;
    if (command === 'setup') {
      return runSetupCommand(rest, { version: packageVersion() });
    }
    if (command === 'init' || command === 'doctor' || command === 'config') {
      return runBootstrapCommand(command, rest, { version: packageVersion() });
    }
    if (command === 'event') {
      return runEventCommand(rest);
    }
    if (command === 'route') {
      return runRouteCommand(rest);
    }
    if (command === 'promote') {
      return runPromoteCommand(rest);
    }
    if (command === 'proposal') {
      return runProposalCommand(rest);
    }
    if (command === 'eval') {
      return runEvalCommand(rest);
    }
    if (command !== 'skill') throw new UsageError(`unknown command: ${command}`);

    if (rest.length === 0 || rest[0] === '-h' || rest[0] === '--help') {
      printSkillUsage();
      return 0;
    }
    if (rest[0] === 'help') {
      return printSkillHelp(rest.slice(1));
    }
    if (hasHelpFlag(rest.slice(1))) {
      return printSkillHelp([rest[0]]);
    }
    if (rest[0] === '--version') {
      throw new UsageError('--version is only supported at the top level');
    }
    if (rest[0].startsWith('-')) {
      throw new UsageError(`unknown option: ${rest[0]}`);
    }

    return runSkillCommand(parseSkillArgs(rest));
  } catch (error) {
    if (error instanceof UsageError || error instanceof SkillManagerError || error instanceof BootstrapError || error instanceof SetupError || error instanceof PromoteError || error instanceof ProposalError || error instanceof EventError || error instanceof RouteError || error instanceof EvalHandoffError) {
      console.error(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}


function printHelp(topics) {
  if (topics.length === 0) {
    printTopUsage();
    return 0;
  }
  if (topics[0] === 'skill') {
    return printSkillHelp(topics.slice(1));
  }
  if (topics[0] === 'event') {
    return printEventHelp(topics.slice(1));
  }
  if (topics[0] === 'route') {
    return printRouteHelp(topics.slice(1));
  }
  if (topics[0] === 'promote') {
    return printPromoteHelp(topics.slice(1));
  }
  if (topics[0] === 'proposal') {
    return printProposalHelp(topics.slice(1));
  }
  if (topics[0] === 'eval') {
    return printEvalHelp(topics.slice(1));
  }
  if (topics[0] === 'init') {
    console.log(`Usage: noesis init [--workspace <path>] [--with <components>] [--force] [--json]

Create Noesis-owned bootstrap state and a .noesis/config.toml manifest.

Options:
  --workspace <path>            Workspace root. Defaults to the current directory.
  --with <list>                 Comma-separated components: pamem,loreforge or none.
  --force                       Overwrite an existing .noesis/config.toml.
  --json                        Print machine-readable JSON.`);
    return 0;
  }
  if (topics[0] === 'setup') {
    console.log(`Usage: noesis setup [--workspace <path>] [--with <components>] [--component <name=path>] [--runtime codex|claude|both] [--force] [--json]

One-step local HS workspace bootstrap. This command runs Noesis init, installs
required entry skills, wires local pamem/LoreForge component sources when
provided, installs the pamem runtime capability, and finishes with doctor.

Options:
  --workspace <path>            Workspace root. Defaults to the current directory.
  --with <list>                 Comma-separated components: pamem,loreforge or none.
  --component <name=path>       Local component repo/source, e.g. pamem=/path/to/pamem.
  --runtime <codex|claude|both> Runtime to use when adding pamem. Defaults to codex.
  --force                       Overwrite an existing .noesis/config.toml.
  --json                        Print machine-readable JSON.`);
    return 0;
  }
  if (topics[0] === 'doctor') {
    console.log(`Usage: noesis doctor [--workspace <path>] [--json]

Read-only check of the Noesis manifest and declared component readiness.

Options:
  --workspace <path>            Workspace root. Defaults to the current directory.
  --json                        Print machine-readable JSON.`);
    return 0;
  }
  if (topics[0] === 'config') {
    console.log(`Usage: noesis config show [--workspace <path>] [--json]

Show the Noesis bootstrap manifest.

Options:
  --workspace <path>            Workspace root. Defaults to the current directory.
  --json                        Print parsed manifest as machine-readable JSON.`);
    return 0;
  }
  throw new UsageError(`unknown help topic: ${topics.join(' ')}`);
}


function printEventHelp(topics) {
  if (topics.length === 0) {
    printEventUsage();
    return 0;
  }
  const [topic, ...extra] = topics;
  if (extra.length > 0) {
    throw new UsageError(`unknown help topic: event ${topics.join(' ')}`);
  }
  if (topic === 'check') {
    printEventCheckUsage();
    return 0;
  }
  if (topic === 'promote') {
    printEventPromoteUsage();
    return 0;
  }
  throw new UsageError(`unknown event command: ${topic}`);
}


function printRouteHelp(topics) {
  if (topics.length === 0) {
    printRouteUsage();
    return 0;
  }
  if (topics.length === 1 && topics[0] === 'help') {
    printRouteUsage();
    return 0;
  }
  if (topics.length > 0) {
    throw new UsageError(`unknown help topic: route ${topics.join(' ')}`);
  }
}


function printPromoteHelp(topics) {
  if (topics.length === 0) {
    printPromoteUsage();
    return 0;
  }
  const [topic, ...extra] = topics;
  if (extra.length > 0) {
    throw new UsageError(`unknown help topic: promote ${topics.join(' ')}`);
  }
  if (topic === 'check') {
    printPromoteCheckUsage();
    return 0;
  }
  if (topic === 'plan') {
    printPromotePlanUsage();
    return 0;
  }
  throw new UsageError(`unknown promote command: ${topic}`);
}


function printProposalHelp(topics) {
  if (topics.length === 0) {
    printProposalUsage();
    return 0;
  }
  const [topic, ...extra] = topics;
  if (extra.length > 0) {
    throw new UsageError(`unknown help topic: proposal ${topics.join(' ')}`);
  }
  if (['list', 'show', 'update', 'summary'].includes(topic)) {
    printProposalCommandUsage(topic);
    return 0;
  }
  throw new UsageError(`unknown proposal command: ${topic}`);
}


function printEvalHelp(topics) {
  if (topics.length === 0) {
    printEvalUsage();
    return 0;
  }
  const [topic, ...extra] = topics;
  if (extra.length > 0) {
    throw new UsageError(`unknown help topic: eval ${topics.join(' ')}`);
  }
  if (topic === 'handoff') {
    printEvalHandoffUsage();
    return 0;
  }
  throw new UsageError(`unknown eval command: ${topic}`);
}


function printSkillHelp(topics) {
  if (topics.length === 0) {
    printSkillUsage();
    return 0;
  }
  const [topic, ...extra] = topics;
  if (extra.length > 0) {
    throw new UsageError(`unknown help topic: skill ${topics.join(' ')}`);
  }
  const usage = SKILL_COMMAND_USAGE[topic];
  if (!usage) {
    throw new UsageError(`unknown skill command: ${topic}`);
  }
  console.log(usage);
  return 0;
}


function printTopUsage() {
  console.log(TOP_USAGE);
}


function printSkillUsage() {
  console.log(SKILL_USAGE);
}


function packageVersion() {
  return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
}


function hasHelpFlag(tokens) {
  return tokens.includes('-h') || tokens.includes('--help');
}


function parseSkillArgs(argv) {
  const [skillCommand, ...tokens] = argv;
  const args = {
    skillCommand,
    workspace: null,
    agentId: null,
    globalScope: false,
    json: false,
    source: null,
    alias: null,
    runtime: null,
    name: null,
  };
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-h' || token === '--help') {
      return { skillCommand: 'help' };
    }
    if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
    } else if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
    } else if (token === '--agent-id') {
      args.agentId = requireValue(tokens, ++index, '--agent-id');
    } else if (token.startsWith('--agent-id=')) {
      args.agentId = token.slice('--agent-id='.length);
    } else if (token === '--global') {
      args.globalScope = true;
    } else if (token === '--json') {
      args.json = true;
    } else if (token === '--source') {
      args.source = requireValue(tokens, ++index, '--source');
    } else if (token.startsWith('--source=')) {
      args.source = token.slice('--source='.length);
    } else if (token === '--alias') {
      args.alias = requireValue(tokens, ++index, '--alias');
    } else if (token.startsWith('--alias=')) {
      args.alias = token.slice('--alias='.length);
    } else if (token === '--runtime') {
      args.runtime = requireValue(tokens, ++index, '--runtime');
    } else if (token.startsWith('--runtime=')) {
      args.runtime = token.slice('--runtime='.length);
    } else if (token.startsWith('-')) {
      throw new UsageError(`unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }

  if (args.skillCommand === 'list') {
    rejectPositionals(positionals, 'list');
    rejectSourceOptions(args, 'list');
    rejectRuntime(args, 'list');
  } else if (args.skillCommand === 'inspect') {
    args.name = requirePositionals(positionals, 1, 'inspect <name>')[0];
    rejectAlias(args, 'inspect');
    rejectRuntime(args, 'inspect');
  } else if (args.skillCommand === 'verify') {
    if (positionals.length > 1) throw new UsageError('usage: noesis skill verify [name]');
    args.name = positionals[0] || null;
    rejectAlias(args, 'verify');
    rejectRuntime(args, 'verify');
  } else if (args.skillCommand === 'add') {
    args.name = requirePositionals(positionals, 1, 'add <name>')[0];
    validateRuntime(args);
  } else if (args.skillCommand === 'remove') {
    args.name = requirePositionals(positionals, 1, 'remove <name>')[0];
    rejectSourceOptions(args, 'remove');
    validateRuntime(args);
  } else if (args.skillCommand === 'help') {
    return args;
  } else {
    throw new UsageError(`unknown skill command: ${args.skillCommand}`);
  }

  return args;
}


function requireValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith('-')) {
    throw new UsageError(`missing value for ${option}`);
  }
  return value;
}


function rejectPositionals(positionals, command) {
  if (positionals.length > 0) {
    throw new UsageError(`usage: noesis skill ${command}`);
  }
}


function requirePositionals(positionals, count, usage) {
  if (positionals.length !== count) {
    throw new UsageError(`usage: noesis skill ${usage}`);
  }
  return positionals;
}


function rejectSourceOptions(args, command) {
  if (args.source) throw new UsageError(`--source is not supported for ${command}`);
  rejectAlias(args, command);
}


function rejectAlias(args, command) {
  if (args.alias) throw new UsageError(`--alias is not supported for ${command}`);
}


function rejectRuntime(args, command) {
  if (args.runtime) throw new UsageError(`--runtime is not supported for ${command}`);
}


function validateRuntime(args) {
  if (!args.runtime) return;
  if (!['codex', 'claude', 'both'].includes(args.runtime)) {
    throw new UsageError(`unsupported runtime: ${args.runtime}`);
  }
  if (args.name !== 'pamem') {
    throw new UsageError('--runtime is only supported for pamem add/remove');
  }
}
