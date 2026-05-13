const YOOKASSA_SHOP_ID = '1351165';
const YOOKASSA_API_KEY = process.env.YOOKASSA_API_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentId } = req.query;
  if (!paymentId) return res.status(400).json({ error: 'Missing paymentId' });

  try {
    const credentials = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_API_KEY}`).toString('base64');
    const response = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      headers: { 'Authorization': `Basic ${credentials}` },
    });
    const payment = await response.json();
    console.log('payment status check:', payment.id, payment.status);
    return res.status(200).json({ status: payment.status });
  } catch (err) {
    console.error('check payment error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
