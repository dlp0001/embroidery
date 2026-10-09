'use client';

import { useActionState } from 'react';
import { openCourseAction, type OpenState } from '../../actions';
import { MAX_DEVICES } from '@/lib/course-limits';
import RequestLinkForm from '../../RequestLinkForm';

export default function OpenForm({ token, course }: { token: string; course: string }) {
  const [state, open, opening] = useActionState(openCourseAction, {} as OpenState);

  if (state.error === 'full') {
    return (
      <>
        <p className="gate-text">
          Курс уже открыт на {MAX_DEVICES} устройствах — это предел для одного доступа.
          Пришлём свежую ссылку на почту покупателя: по ней это устройство займёт место
          того, которым дольше всего не пользовались.
        </p>
        <RequestLinkForm course={course} />
      </>
    );
  }
  if (state.error) {
    return (
      <>
        <p className="gate-text">Эта ссылка больше не работает. Пришлём новую на почту покупателя.</p>
        <RequestLinkForm course={course} />
      </>
    );
  }

  return (
    <form action={open}>
      <input type="hidden" name="token" value={token} />
      <button className="btn" type="submit" disabled={opening}>
        {opening ? 'Открываю…' : 'Открыть курс'}
      </button>
    </form>
  );
}
