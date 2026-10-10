import { handle } from '../compras/handlers';
export function GET(request: Request) { return handle(request, 'supplier'); }
export function POST(request: Request) { return handle(request, 'supplier'); }
