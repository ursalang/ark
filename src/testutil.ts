// Ark test utility routines.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

import fs from 'fs'
import test from 'ava'
import {ArkState, debug} from './interpreter.js'
import {compile} from './parser.js'
import {toJs} from './ffi.js'
import {serializeVal} from './serialize.js'

function doCompile(source: string) {
  const compiled = compile(source)
  if (process.env.DEBUG) {
    debug(compiled, null)
  }
  return compiled
}

export function testGroup(
  title: string,
  tests: [string, any][],
) {
  test(title, (t) => {
    for (const [source, expected] of tests) {
      const compiled = doCompile(source)
      t.deepEqual(toJs(new ArkState().run(compiled)), expected)
    }
  })
}

export function cliTest(title: string, file: string) {
  test(title, (t) => {
    const source = fs.readFileSync(`${file}.json`, {encoding: 'utf-8'})
    const expected = fs.readFileSync(`${file}.result.json`, {encoding: 'utf-8'})
    const compiled = doCompile(source)
    t.deepEqual(serializeVal(new ArkState().run(compiled)), expected)
  })
}
