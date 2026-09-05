import { clientIp } from '@/lib/sheets';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(req: Request) {
  const { productId, email, name, telegram, customerIp } = (await req.json()) as Record<string, string>;
  if (!productId || !email) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const response = await fetch('https://api.polar.sh/v1/checkouts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.POLAR_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        products: [productId],
        customer_email: email,
        customer_name: name,
        customer_ip_address: customerIp || clientIp(req),
        success_url: 'https://re-create.art/embroidery?success=true',
        metadata: { telegram, name },
      }),
    });

    const data = await response.json();
    console.log('Polar checkout status:', response.status);

    if (!response.ok) {
      console.error('Polar checkout error:', JSON.stringify(data));
      return Response.json({ error: 'Checkout creation failed' }, { status: 500 });
    }
    if (!data?.url) {
      console.error('No checkout URL:', JSON.stringify(data));
      return Response.json({ error: 'No checkout URL' }, { status: 500 });
    }

    console.log('Polar checkout created:', data.url);
    return Response.json({ checkoutUrl: data.url });
  } catch (err) {
    console.error('Polar create checkout error:', err);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
