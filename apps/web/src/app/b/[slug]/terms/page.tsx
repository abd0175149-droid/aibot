import type { Metadata } from 'next';
import { loadBusiness, langOf, pageTitle, BusinessDoc, TermsBody } from '@/lib/business-pages';

/* صفحةٌ عامّةٌ للعميل — تُبنى من ملفّ نشاطه، وتُحدَّث كلّ دقيقة. راجع `lib/business-pages.tsx`. */
export const revalidate = 60;

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const b = await loadBusiness(slug);
  return { title: { absolute: pageTitle(b, langOf(sp), 'terms') } };
}

export default async function Page({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const b = await loadBusiness(slug);
  const l = langOf(sp);
  return (
    <BusinessDoc b={b} l={l} page="terms">
      <TermsBody b={b} l={l} />
    </BusinessDoc>
  );
}
