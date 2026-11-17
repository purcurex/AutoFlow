/** UI aliases and verified FOP codes; preserve unknown warehouses and all scope predicates. */
export function warehouseCodes(code:string):string[]{
 if(['HZ','01'].includes(code))return ['HZ','01']
 if(['SZ','HNDGLB'].includes(code))return ['SZ','HNDGLB']
 return [code]
}
