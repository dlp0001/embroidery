-- Провайдер платежа говорит только о том, кто принял деньги: банк через
-- платёжную страницу, студия сама или подарок. Чем именно отдали, знает
-- pay_method. Раньше принятое на счёт ложилось провайдером 'transfer', и
-- одни и те же деньги выглядели по-разному в зависимости от того, где их
-- приняли: в журнале, в «Оплатах» или при продаже абонемента.

-- Сначала не теряем способ у тех, где он записан только провайдером.
update payments
   set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('pay_method', 'transfer')
 where provider = 'transfer'
   and raw ->> 'pay_method' is null;

update payments
   set provider = 'cash'
 where provider = 'transfer';
