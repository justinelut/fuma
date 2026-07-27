import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function Home() {
  return <main className="mx-auto grid max-w-5xl gap-6 p-6 md:grid-cols-2"><h1 className="col-span-full text-3xl font-semibold">Fuma control surfaces</h1><Card><CardHeader><CardTitle>Customer product</CardTitle></CardHeader><CardContent><Link href="/marketplace">Open reviewed marketplace</Link></CardContent></Card><Card><CardHeader><CardTitle>Internal operations</CardTitle></CardHeader><CardContent><Link href="/internal">Open platform console</Link></CardContent></Card></main>
}
