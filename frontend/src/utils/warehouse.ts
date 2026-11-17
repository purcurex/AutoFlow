/** Canonical display names only. Never replace API identifiers or infer unknown warehouses. */
export function warehouseName(value:string|null|undefined):string{
 const name=value?.trim()??''
 if(['hz','01','hangzhou','杭州仓','杭州'].includes(name.toLowerCase()))return 'HangZhou'
 if(['sz','hndglb','shenzhen','深圳仓','深圳'].includes(name.toLowerCase()))return 'ShenZhen'
 return name||'—'
}
