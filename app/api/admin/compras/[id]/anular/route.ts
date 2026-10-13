import { handle } from '../../handlers';
export async function POST(request:Request, context:{params:Promise<{id:string}>}) { const {id}=await context.params; return handle(request,'annul-purchase',id); }
