import { SkillManagerError, runSkillCommand } from './skill-manager.mjs';


const TOP_USAGE = `Usage: noesis <command> [args]

Commands:
  skill     Manage agent skill visibility.

Options:
  -h, --help  Show this help message.`;

const SKILL_USAGE = `Usage: noesis skill <command> [args]

Commands:
  list                    List visible skills.
  inspect <name>          Inspect one skill.
  verify [name]           Verify visible skill links.
  add <name>              Add a skill to Claude and Codex.
  remove <name>           Remove visible skill links.

Target options:
  --workspace <path>      Workspace root to manage. Defaults to the current directory.
  --agent-id <id>         Resolve a pamem agent workspace via 'pamem status --json'.
  --global                Manage global ~/.codex/skills and ~/.claude/skills visibility.
  --json                  Print machine-readable JSON.

Source options:
  --source <path>         Explicit source under this package's skills/ or ~/skills.
  --alias <name>          Link name for 'add'. Defaults to the source basename.`;


class UsageError extends Error {}


export function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
      console.log(TOP_USAGE);
      return 0;
    }

    const [command, ...rest] = argv;
    if (command !== 'skill') {
      throw new UsageError(`unknown command: ${command}`);
    }

    if (rest.length === 0 || rest[0] === '-h' || rest[0] === '--help') {
      console.log(SKILL_USAGE);
      return 0;
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
      console.log(SKILL_USAGE);
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
