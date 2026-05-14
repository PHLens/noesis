import fs from 'node:fs';
import { SkillManagerError, runSkillCommand } from './skill-manager.mjs';


const TOP_USAGE = `Usage: noesis <command> [args]

Commands:
  skill                         Manage agent skill visibility.
  help [command]                Show command help.

Options:
  -h, --help                    Show this help message.
  --version                     Show package version.

Examples:
  noesis skill list
  noesis skill add planning-with-files --workspace /path/to/workspace
  noesis help skill add`;

const SKILL_USAGE = `Usage: noesis skill <command> [args]

Commands:
  list                          List visible skills.
  inspect <name>                Inspect one skill.
  verify [name]                 Verify visible skill links.
  add <name>                    Add a skill to Claude and Codex.
  remove <name>                 Remove visible skill links.
  help [command]                Show skill command help.

Target options:
  --workspace <path>            Workspace root to manage. Defaults to the current directory.
  --agent-id <id>               Resolve a pamem agent workspace via 'pamem status --json'.
  --global                      Manage global ~/.codex/skills and ~/.claude/skills visibility.
  --json                        Print machine-readable JSON.

Source options:
  --source <path>               Explicit source under this package's skills/ or ~/skills.
  --alias <name>                Link name for 'add'. Defaults to the source basename.

Examples:
  noesis skill list --agent-id coder-local
  noesis skill inspect planning-with-files --json
  noesis skill verify
  noesis skill add planning-with-files --alias planner
  noesis skill remove planner

Use "noesis skill <command> --help" for command-specific options.`;

const SKILL_COMMAND_USAGE = {
  list: `Usage: noesis skill list [target-options] [--json]

List skills currently visible through .codex/skills and .claude/skills.

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

Inspect one skill source and its visible runtime links.

Target options:
  --workspace <path>            Workspace root to manage. Defaults to the current directory.
  --agent-id <id>               Resolve a pamem agent workspace via 'pamem status --json'.
  --global                      Manage global ~/.codex/skills and ~/.claude/skills visibility.

Source options:
  --source <path>               Explicit source under this package's skills/ or ~/skills.

Output options:
  --json                        Print machine-readable JSON.

Examples:
  noesis skill inspect planning-with-files
  noesis skill inspect planning-with-files --source ~/skills/planning-with-files
  noesis skill inspect planning-with-files --json`,

  verify: `Usage: noesis skill verify [name] [target-options] [source-options] [--json]

Verify visible skill links. With a name, also verifies the resolved source.
Exits 0 when verification passes and 1 when any checked skill fails.

Target options:
  --workspace <path>            Workspace root to manage. Defaults to the current directory.
  --agent-id <id>               Resolve a pamem agent workspace via 'pamem status --json'.
  --global                      Manage global ~/.codex/skills and ~/.claude/skills visibility.

Source options:
  --source <path>               Explicit source under this package's skills/ or ~/skills.

Output options:
  --json                        Print machine-readable JSON.

Examples:
  noesis skill verify
  noesis skill verify planning-with-files
  noesis skill verify planning-with-files --source ~/skills/planning-with-files --json`,

  add: `Usage: noesis skill add <name> [target-options] [source-options] [--json]

Add a skill by creating relative symlinks in both .codex/skills and
.claude/skills. Managed sources under this package's skills/ are preferred;
~/skills remains supported as an external compatibility source.

Target options:
  --workspace <path>            Workspace root to manage. Defaults to the current directory.
  --agent-id <id>               Resolve a pamem agent workspace via 'pamem status --json'.
  --global                      Manage global ~/.codex/skills and ~/.claude/skills visibility.

Source options:
  --source <path>               Explicit source under this package's skills/ or ~/skills.
  --alias <name>                Link name to create. Defaults to the source basename.

Output options:
  --json                        Print machine-readable JSON.

Examples:
  noesis skill add planning-with-files
  noesis skill add planning-with-files --workspace /path/to/workspace
  noesis skill add planning-with-files --alias planner`,

  remove: `Usage: noesis skill remove <name> [target-options] [--json]

Remove visible skill symlinks from both .codex/skills and .claude/skills.
The source skill directory is never deleted.

Target options:
  --workspace <path>            Workspace root to manage. Defaults to the current directory.
  --agent-id <id>               Resolve a pamem agent workspace via 'pamem status --json'.
  --global                      Manage global ~/.codex/skills and ~/.claude/skills visibility.

Output options:
  --json                        Print machine-readable JSON.

Examples:
  noesis skill remove planning-with-files
  noesis skill remove planner --workspace /path/to/workspace
  noesis skill remove planning-with-files --global`,
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
    if (command !== 'skill') {
      throw new UsageError(`unknown command: ${command}`);
    }

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
    if (error instanceof UsageError || error instanceof SkillManagerError) {
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
  throw new UsageError(`unknown help topic: ${topics.join(' ')}`);
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
    } else if (token.startsWith('-')) {
      throw new UsageError(`unknown option: ${token}`);
    } else {
      positionals.push(token);
    }
  }

  if (args.skillCommand === 'list') {
    rejectPositionals(positionals, 'list');
    rejectSourceOptions(args, 'list');
  } else if (args.skillCommand === 'inspect') {
    args.name = requirePositionals(positionals, 1, 'inspect <name>')[0];
    rejectAlias(args, 'inspect');
  } else if (args.skillCommand === 'verify') {
    if (positionals.length > 1) throw new UsageError('usage: noesis skill verify [name]');
    args.name = positionals[0] || null;
    rejectAlias(args, 'verify');
  } else if (args.skillCommand === 'add') {
    args.name = requirePositionals(positionals, 1, 'add <name>')[0];
  } else if (args.skillCommand === 'remove') {
    args.name = requirePositionals(positionals, 1, 'remove <name>')[0];
    rejectSourceOptions(args, 'remove');
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
