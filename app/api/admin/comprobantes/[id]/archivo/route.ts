import { receiptHandler } from '../../handlers';
export const runtime = 'nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {return receiptHandler(request,'read',(await params).id);}
