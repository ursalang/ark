// Ursa front-end

import path from 'path'
import fs from 'fs'
import * as readline from 'node:readline'
import {ArgumentParser, RawDescriptionHelpFormatter} from 'argparse'
import assert from 'assert'
import programVersion from '../version.js'
import {
  BindingVal, EnvironmentVal, List, Ref, Str, evalArk, valToJson, valueOf,
} from '../ark/interp.js'
import {compile as arkCompile} from '../ark/parser.js'
import {compile as ursaCompile} from './parser.js'

// Read and process arguments
const parser = new ArgumentParser({
  description: 'The Ursa language.',
  formatter_class: RawDescriptionHelpFormatter,
})
const inputGroup = parser.add_mutually_exclusive_group()

inputGroup.add_argument('module', {metavar: 'FILE', help: 'Ursa module to run', nargs: '?'})
parser.add_argument('argument', {metavar: 'ARGUMENT', help: 'arguments to the Ursa module', nargs: '*'})
inputGroup.add_argument('--eval', '-e', {metavar: 'EXPRESSION', help: 'execute the given expression'})

parser.add_argument('--syntax', {
  default: 'ursa', choices: ['ursa', 'json'], help: 'syntax to use [default: ursa]',
})
parser.add_argument('--compile', '-c', {action: 'store_true', help: 'compile input to JSON file'})
parser.add_argument('--output', '-o', {metavar: 'FILE', help: 'JSON output file [default: INPUT-FILE.json]'})
parser.add_argument('--interactive', '-i', {action: 'store_true', help: 'enter interactive mode after running given code'})

parser.add_argument('--version', {
  action: 'version',
  version: `%(prog)s ${programVersion}
© 2023 Reuben Thomas <rrt@sc3d.org>
https://github.com/ursalang/ursa
Distributed under the GNU General Public License version 3, or (at
your option) any later version. There is no warranty.`,
})

interface Args {
  module: string
  eval: string
  syntax: string
  compile: boolean
  output: string | undefined
  interactive: boolean
  // FIXME: add to Ark state.
  argument: string[]
}
const args: Args = parser.parse_args() as Args

function compile(exp: string) {
  switch (args.syntax) {
    case 'json':
      return arkCompile(exp)[0]
    default:
      return ursaCompile(exp)[0]
  }
}

function evaluate(exp: string) {
  return evalArk(compile(exp), new EnvironmentVal([
    new BindingVal(new Map([['argv', new Ref(new List(
      args.argument.map((s) => new Str(s)),
    ))]]))]))
}

async function repl() {
  console.log(`Welcome to Ursa ${programVersion}.`)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  })
  rl.prompt()
  let val
  for await (const line of rl) {
    try {
      val = valueOf(evaluate(line))
      console.dir(val, {depth: null})
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message)
      } else {
        console.error(error)
      }
    }
    rl.prompt()
  }
  return val
}

// Get output filename, if any
let jsonFile = args.output
if (jsonFile === undefined && args.module !== undefined) {
  const parsedFilename = path.parse(args.module)
  jsonFile = path.join(parsedFilename.dir, `${parsedFilename.name}.json`)
}

async function main() {
  // Any otherwise uncaught exception is reported as an error.
  try {
    // Read input
    let source: string | undefined
    let result
    if (args.eval !== undefined) {
      source = args.eval
    } else if (args.module !== undefined) {
      source = fs.readFileSync(args.module, {encoding: 'utf-8'})
    }
    if (args.compile) {
      if (source === undefined) {
        throw new Error('--compile given, but nothing to compile!')
      }
      if (jsonFile === undefined) {
        throw new Error('--compile given with no input or output filename')
      }
      result = compile(source)
    } else {
      // Run the program
      if (source !== undefined) {
        result = evaluate(source)
      }
      if (source === undefined || args.interactive) {
        result = await repl()
      }
      assert(result !== undefined)
    }
    if (args.output) {
      assert(jsonFile)
      fs.writeFileSync(jsonFile, valToJson(result))
    }
  } catch (error) {
    if (process.env.DEBUG) {
      console.error(error)
    } else {
      console.error(`${path.basename(process.argv[1])}: ${error}`)
    }
    process.exitCode = 1
  }
}

main()
