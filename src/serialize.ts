import {PartialCompiledArk} from './compiler.js'
import {
  ArkVal, ArkValRef, ArkConcreteVal,
  ArkUndefined, ArkNull, ArkSequence,
  ArkAnd, ArkOr, ArkIf, ArkLoop,
  ArkGet, ArkSet, ArkLet, ArkCall, ArkFn,
  NativeObject, ArkObject, ArkList, ArkMap, ArkProperty, ArkPropertyRef,
} from './interp.js'

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
  } else if (val instanceof ArkPropertyRef) {
    return ['ref', ['prop', doSerialize(val.obj), val.prop]]
  } else if (val instanceof ArkValRef) {
    return ['ref', doSerialize(val.val)]
  } else if (val instanceof ArkGet) {
    return ['get', doSerialize(val.val)]
  } else if (val instanceof ArkFn) {
    return ['fn', ['params', ...val.params], doSerialize(val.body)]
  } else if (val instanceof ArkObject) {
    const obj = {}
    for (const [k, v] of val.val) {
      (obj as any)[k] = doSerialize(v)
    }
    return obj
  } else if (val instanceof NativeObject) {
    const obj = {}
    for (const k in val.obj) {
      if (Object.hasOwn(val.obj, k)) {
        (obj as any)[k] = doSerialize((val.obj as any)[k])
      }
    }
    return obj
  } else if (val instanceof ArkMap) {
    const obj: any[] = ['map']
    for (const [k, v] of val.map) {
      obj.push([doSerialize(k), doSerialize(v)])
    }
    return obj
  } else if (val instanceof ArkList) {
    return ['list', ...val.list.map(doSerialize)]
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
