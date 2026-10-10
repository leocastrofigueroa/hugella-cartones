import PurchasesView from '../purchases-view';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PurchasesView id={(await params).id} />;
}
