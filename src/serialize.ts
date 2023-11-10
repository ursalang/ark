import {PartialCompiledArk} from './compiler.js'
import {
  ArkAnd, ArkOr, Ass, Call, ConcreteVal, Dict, Fn, Get, If, Let, List, Loop,
  NativeObj, Null, Obj, Prop, PropRef, Seq, Undefined, Val, ValRef,
} from './interp.js'

function doSerialize(val: Val): any {
  if (val.debug !== undefined) {
    const name = val.debug.get('name')
    if (name !== undefined) {
      return name
    }
  }
  if (val instanceof ConcreteVal) {
    const rawVal = val.val
    if (typeof rawVal === 'string') {
      return ['str', val.val]
    }
    return val.val
  } else if (val instanceof PropRef) {
    return ['ref', ['prop', doSerialize(val.obj), val.prop]]
  } else if (val instanceof ValRef) {
    return ['ref', doSerialize(val.val)]
  } else if (val instanceof Get) {
    return ['get', doSerialize(val.val)]
  } else if (val instanceof Fn) {
    return ['fn', ['params', ...val.params], doSerialize(val.body)]
  } else if (val instanceof Obj) {
    const obj = {}
    for (const [k, v] of val.val) {
      (obj as any)[k] = doSerialize(v)
    }
    return obj
  } else if (val instanceof NativeObj) {
    const obj = {}
    for (const k in val.obj) {
      if (Object.hasOwn(val.obj, k)) {
        (obj as any)[k] = doSerialize((val.obj as any)[k])
      }
    }
    return obj
  } else if (val instanceof Dict) {
    const obj: any[] = ['map']
    for (const [k, v] of val.map) {
      obj.push([doSerialize(k), doSerialize(v)])
    }
    return obj
  } else if (val instanceof List) {
    return ['list', ...val.list.map(doSerialize)]
  } else if (val instanceof Let) {
    return ['let', ['params', ...val.boundVars], doSerialize(val.body)]
  } else if (val instanceof Call) {
    return [doSerialize(val.fn), ...val.args.map(doSerialize)]
  } else if (val instanceof Ass) {
    return ['set', doSerialize(val.ref), doSerialize(val.val)]
  } else if (val instanceof Prop) {
    return ['prop', val.prop, doSerialize(val.obj)]
  } else if (val instanceof Seq) {
    return ['seq', ...val.exps.map(doSerialize)]
  } else if (val instanceof If) {
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
  } else if (val instanceof Loop) {
    return ['and', doSerialize(val.body)]
  } else if (val === Null()) {
    return null
  } else if (val === Undefined) {
    return undefined
  }
  return val.toString()
}

export function serializeVal(val: Val) {
  return JSON.stringify(doSerialize(val))
}

export function serializeCompiledArk(compiled: PartialCompiledArk): string {
  return JSON.stringify([
    doSerialize(compiled.value),
    JSON.stringify(compiled.freeVars),
    JSON.stringify(compiled.boundVars),
  ])
}
