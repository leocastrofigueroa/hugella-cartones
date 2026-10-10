import { receiptHandler } from '../../../comprobantes/handlers';
export const runtime = 'nodejs';
type Context = { params: Promise<{id:string}> };
export async function GET(request:Request,{params}:Context) {return receiptHandler(request,'list',(await params).id);}
export async function POST(request:Request,{params}:Context) {return receiptHandler(request,'upload',(await params).id);}
