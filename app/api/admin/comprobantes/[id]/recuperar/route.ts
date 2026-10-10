import { receiptHandler } from '../../handlers';
export const runtime = 'nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {return receiptHandler(request,'recover',(await params).id);}
