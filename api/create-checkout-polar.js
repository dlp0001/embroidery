const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { productId, email, name, telegram, customerIp } = req.body;

  if (!productId || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Get customer IP for currency detection
  const ipAddress = customerIp || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';

  try {
    const response = await fetch('https://api.polar.sh/v1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${POLAR_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        products: [productId],
        customer_email: email,
        customer_name: name,
        customer_ip_address: ipAddress,
        success_url: 'https://re-create.art/register?success=true',
        metadata: {
          telegram,
          name,
        },
      }),
    });

    const data = await response.json();
    console.log('Polar checkout status:', response.status);

    if (!response.ok) {
      console.error('Polar checkout error:', JSON.stringify(data));
      return res.status(500).json({ error: 'Checkout creation failed' });
    }

    const checkoutUrl = data?.url;
    if (!checkoutUrl) {
      console.error('No checkout URL:', JSON.stringify(data));
      return res.status(500).json({ error: 'No checkout URL' });
    }

    console.log('Polar checkout created:', checkoutUrl);
    return res.status(200).json({ checkoutUrl });

  } catch (err) {
    console.error('Polar create checkout error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
