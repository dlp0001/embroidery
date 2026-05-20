const LS_API_KEY = process.env.LEMONSQUEEZY_API_KEY;
const LS_STORE_ID = '377594';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { variantId, email, name, telegram } = req.body;

  if (!variantId || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LS_API_KEY}`,
        'Content-Type': 'application/vnd.api+json',
        'Accept': 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              email,
              name,
              custom: {
                telegram,
              },
            },
            product_options: {
              redirect_url: 'https://re-create.art/register?success=true',
            },
          },
          relationships: {
            store: {
              data: { type: 'stores', id: LS_STORE_ID },
            },
            variant: {
              data: { type: 'variants', id: variantId },
            },
          },
        },
      }),
    });

    const data = await response.json();
    console.log('LS checkout response status:', response.status);

    if (!response.ok) {
      console.error('LS checkout error:', JSON.stringify(data));
      return res.status(500).json({ error: 'Checkout creation failed' });
    }

    const checkoutUrl = data?.data?.attributes?.url;
    if (!checkoutUrl) {
      console.error('No checkout URL in response:', JSON.stringify(data));
      return res.status(500).json({ error: 'No checkout URL' });
    }

    console.log('LS checkout created:', checkoutUrl);
    return res.status(200).json({ checkoutUrl });

  } catch (err) {
    console.error('LS create checkout error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
