import { handle } from '../handlers';
export function GET(request: Request) { return handle(request, 'summaries'); }
