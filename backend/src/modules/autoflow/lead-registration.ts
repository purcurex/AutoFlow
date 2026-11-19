import { BadRequestException } from '@nestjs/common'
import { Workbook } from 'exceljs'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { RegisterLeadDto } from './dto/autoflow.dto'
export const leadColumns = [
 ['客户名称','brandName'],['国家','country'],['店铺链接','storeUrl'],['登记日期','registeredOn'],['联系日期','contactedOn'],['产品分类','category'],['城市','city'],['Facebook链接','facebook'],['WhatsApp','whatsapp'],['目前跟进情况','currentFollowUp'],['下一步跟进计划','nextFollowUpPlan'],
] as const
export async function leadTemplate() {
 const book=new Workbook();const sheet=book.addWorksheet('线索登记');sheet.columns=leadColumns.map(([header,key])=>({header,key,width:['storeUrl','facebook','currentFollowUp','nextFollowUpPlan'].includes(key)?38:20}));
 sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF4F67BF'}};sheet.views=[{state:'frozen',ySplit:1}];
 sheet.getColumn('whatsapp').numFmt='@';
 sheet.getColumn('registeredOn').numFmt='yyyy-mm-dd';sheet.getColumn('contactedOn').numFmt='yyyy-mm-dd';
 return Buffer.from(await book.xlsx.writeBuffer())
}
export async function readLeadWorkbook(buffer: Buffer) {
 const book=new Workbook();try {await book.xlsx.load(buffer as any)}catch{throw new BadRequestException('无法读取文件，请使用Excel .xlsx模板')}
 const sheet=book.worksheets[0];if(!sheet||sheet.rowCount<2)throw new BadRequestException('文件没有线索数据');if(sheet.rowCount>1001)throw new BadRequestException('每次最多导入1000行');
 const headers=new Map<string,number>();sheet.getRow(1).eachCell((cell,i)=>headers.set(cell.text.trim(),i));
 for(const required of ['客户名称','国家','店铺链接'])if(!headers.has(required))throw new BadRequestException(`缺少列：${required}`)
 const result: {row:number;data:RegisterLeadDto;error?:string}[]=[];
 for(let i=2;i<=sheet.rowCount;i++){
  const raw:Record<string,string>={};let invalid=false;
  for(const [label,key] of leadColumns){const col=headers.get(label);if(!col)continue;const cell=sheet.getCell(i,col);if(cell.type===6){invalid=true;continue}const value=cell.value instanceof Date?cell.value.toISOString().slice(0,10):cell.text.trim();if(value)raw[key]=value}
  if(!Object.keys(raw).length&&!invalid)continue;
  const data=plainToInstance(RegisterLeadDto,raw);const errors=await validate(data,{whitelist:true,forbidNonWhitelisted:true});
  result.push({row:i,data,error:invalid?'不支持公式，请粘贴为值':errors.length?errors.map(e=>leadColumns.find(c=>c[1]===e.property)?.[0]??e.property).join('、')+'格式不正确或必填项为空':undefined})
 }
 return result
}
