export const runtime = 'nodejs';

const LS_STORE_ID = '377594';

export async function POST(req: Request) {
  const { variantId, email, name, telegram } = (await req.json()) as Record<string, string>;
  if (!variantId || !email) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: { email, name, custom: { telegram } },
            product_options: { redirect_url: 'https://re-create.art/register?success=true' },
          },
          relationships: {
            store: { data: { type: 'stores', id: LS_STORE_ID } },
            variant: { data: { type: 'variants', id: variantId } },
          },
        },
      }),
    });

    const data = await response.json();
    console.log('LS checkout response status:', response.status);

    if (!response.ok) {
      console.error('LS checkout error:', JSON.stringify(data));
      return Response.json({ error: 'Checkout creation failed' }, { status: 500 });
    }
    const checkoutUrl = data?.data?.attributes?.url;
    if (!checkoutUrl) {
      console.error('No checkout URL in response:', JSON.stringify(data));
      return Response.json({ error: 'No checkout URL' }, { status: 500 });
    }

    console.log('LS checkout created:', checkoutUrl);
    return Response.json({ checkoutUrl });
  } catch (err) {
    console.error('LS create checkout error:', err);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
