import { handle } from '../handlers';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, 'detail', (await params).id);
}
