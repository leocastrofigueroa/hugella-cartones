import { handle } from '../../handlers';
export function POST(request: Request) { return handle(request, 'summary-payment'); }
