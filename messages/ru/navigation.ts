import { navigation as english } from '../en/navigation';
import type { MessageShape } from '@/i18n/message-types';

export const navigation = {
  home: 'Главная',
  history: 'История',
  progress: 'Прогресс',
  coach: 'Тренер',
  chat: 'Чат',
  programs: 'Программы',
  catalog: 'Упражнения',
  nutrition: 'Питание',
  posture: 'Осанка',
  kitchen: 'Кухня',
  settings: 'Настройки',
} satisfies MessageShape<typeof english>;
