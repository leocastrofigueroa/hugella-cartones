import { handle } from './handlers';
export function GET(request: Request) { return handle(request, 'purchase'); }
export function POST(request: Request) { return handle(request, 'purchase'); }
