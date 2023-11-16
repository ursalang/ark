// Serialize Ark code to JSON.
// © Reuben Thomas 2023
// Released under the GPL version 3, or (at your option) any later version.

import {PartialCompiledArk} from './parser.js'
import {
  ArkVal, ArkValRef, ArkConcreteVal,
  ArkUndefined, ArkNull, ArkSequence,
  ArkAnd, ArkOr, ArkIf, ArkLoop,
  ArkGet, ArkSet, ArkLet, ArkCall, ArkFn,
  NativeObject, ArkObject, ArkList, ArkMap, ArkProperty, ArkPropertyRef,
  ArkLiteral, ArkListLiteral, ArkMapLiteral, ArkObjectLiteral,
  ArkStackRef, ArkCaptureRef,
} from './interpreter.js'

function doSerialize(val: ArkVal): any {
  if (val.debug !== undefined) {
    const name = val.debug.get('name')
    if (name !== undefined) {
      return name
    }
  }
  if (val instanceof ArkConcreteVal) {
    const rawVal = val.val
    if (typeof rawVal === 'string') {
      return ['str', val.val]
    }
    return val.val
  } else if (val instanceof ArkLiteral) {
    return doSerialize(val.val)
  } else if (val instanceof ArkPropertyRef) {
    return ['ref', ['prop', doSerialize(val.obj), val.prop]]
  } else if (val instanceof ArkStackRef || val instanceof ArkCaptureRef) {
    return 'foo'
  } else if (val instanceof ArkValRef) {
    return ['ref', doSerialize(val.val)]
  } else if (val instanceof ArkGet) {
    return ['get', doSerialize(val.val)]
  } else if (val instanceof ArkFn) {
    return ['fn', ['params', ...val.params], doSerialize(val.body)]
  } else if (val instanceof ArkObject || val instanceof ArkObjectLiteral) {
    const obj = {}
    for (const [k, v] of val.val) {
      (obj as any)[k] = doSerialize(v)
    }
    return obj
  } else if (val instanceof ArkList || val instanceof ArkListLiteral) {
    return ['list', ...val.list.map(doSerialize)]
  } else if (val instanceof ArkMap || val instanceof ArkMapLiteral) {
    const obj: any[] = ['map']
    for (const [k, v] of val.map) {
      obj.push([doSerialize(k), doSerialize(v)])
    }
    return obj
  } else if (val instanceof ArkLet) {
    return ['let', ['params', ...val.boundVars], doSerialize(val.body)]
  } else if (val instanceof ArkCall) {
    return [doSerialize(val.fn), ...val.args.map(doSerialize)]
  } else if (val instanceof ArkSet) {
    return ['set', doSerialize(val.ref), doSerialize(val.val)]
  } else if (val instanceof ArkProperty) {
    return ['prop', val.prop, doSerialize(val.obj)]
  } else if (val instanceof ArkSequence) {
    return ['seq', ...val.exps.map(doSerialize)]
  } else if (val instanceof ArkIf) {
    return [
      'if',
      doSerialize(val.cond),
      doSerialize(val.thenExp),
      val.elseExp ? doSerialize(val.elseExp) : undefined,
    ]
  } else if (val instanceof ArkAnd) {
    return ['and', doSerialize(val.left), doSerialize(val.right)]
  } else if (val instanceof ArkOr) {
    return ['or', doSerialize(val.left), doSerialize(val.right)]
  } else if (val instanceof ArkLoop) {
    return ['and', doSerialize(val.body)]
  } else if (val === ArkNull()) {
    return null
  } else if (val === ArkUndefined) {
    return undefined
  } else if (val instanceof NativeObject) {
    const obj = {}
    for (const k in val.obj) {
      if (Object.hasOwn(val.obj, k)) {
        (obj as any)[k] = doSerialize((val.obj as any)[k])
      }
    }
    return obj
  }
  return val.toString()
}

export function serializeVal(val: ArkVal) {
  return JSON.stringify(doSerialize(val))
}

export function serializeCompiledArk(compiled: PartialCompiledArk): string {
  return JSON.stringify([
    doSerialize(compiled.value),
    JSON.stringify(compiled.freeVars),
    JSON.stringify(compiled.boundVars),
  ])
}
