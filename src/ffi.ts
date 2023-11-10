import {
  ArkState, ArkBoolean, ArkConcreteVal, ArkMap, ArkMapLiteral, ArkList, ArkListLiteral,
  NativeFn, NativeObject, ArkNull, ArkNumber, ArkObject, ArkString, ArkVal,
} from './interpreter.js'

export class ArkFromJsError extends Error {}

export function fromJs(x: any, thisObj?: Object): ArkVal {
  if (x === null || x === undefined) {
    return ArkNull()
  }
  if (typeof x === 'boolean') {
    return ArkBoolean(x)
  }
  if (typeof x === 'number') {
    return ArkNumber(x)
  }
  if (typeof x === 'string') {
    return ArkString(x)
  }
  if (typeof x === 'function') {
    const fn = thisObj ? x.bind(thisObj) : x
    const nativeFn = new NativeFn(
      (_ark: ArkState, ...args: ArkVal[]) => fromJs(fn(...args.map(toJs))),
    )
    nativeFn.debug.set('name', x.name)
    return nativeFn
  }
  if (x instanceof Array) {
    return new ArkListLiteral(x)
  }
  if (x instanceof Map) {
    return new ArkMapLiteral(x)
  }
  if (typeof x === 'object') {
    return new NativeObject(x)
  }
  throw new ArkFromJsError(`Cannot convert JavaScript value ${x}`)
}

export function toJs(val: ArkVal): any {
  if (val instanceof ArkConcreteVal) {
    return val.val
  } else if (val instanceof ArkObject) {
    const obj = {}
    for (const [k, v] of val.val) {
      (obj as any)[k] = toJs(v)
    }
    return obj
  } else if (val instanceof ArkMap) {
    const jsMap = new Map<any, ArkVal>()
    for (const [k, v] of val.map) {
      jsMap.set(toJs(k), toJs(v))
    }
    return jsMap
  } else if (val instanceof ArkList) {
    return val.list.map(toJs)
  }
  return val
}
