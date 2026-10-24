'use strict';

/* Локальный генератор русскоязычных имён. Подключается как обычный script
   и публикует StartupNameGenerator для основной игры. */
(function attachNameGenerator(root) {
  const CONFIG = {
    nicknameChance: 0.16,
    maxLength: 32,
    masculineNames: [
      'Алексей', 'Артём', 'Аркадий', 'Борис', 'Вадим', 'Валерий', 'Виктор', 'Владимир',
      'Глеб', 'Григорий', 'Даниил', 'Денис', 'Дмитрий', 'Егор', 'Иван', 'Игорь', 'Кирилл',
      'Константин', 'Леонид', 'Максим', 'Матвей', 'Михаил', 'Никита', 'Олег', 'Павел',
      'Пётр', 'Роман', 'Семён', 'Сергей', 'Станислав', 'Тимур', 'Фёдор', 'Юрий', 'Ярослав', 'Паша'
    ],
    feminineNames: [
      'Агата', 'Александра', 'Алина', 'Алёна', 'Алла', 'Анастасия', 'Анна', 'Валерия',
      'Варвара', 'Вера', 'Вероника', 'Виктория', 'Галина', 'Дарья', 'Ева', 'Екатерина',
      'Елена', 'Зоя', 'Ирина', 'Карина', 'Кира', 'Ксения', 'Лариса', 'Лидия', 'Людмила',
      'Марина', 'Мария', 'Надежда', 'Наталья', 'Ника', 'Оксана', 'Ольга', 'Полина', 'Раиса',
      'Светлана', 'Тамара', 'Татьяна', 'Ульяна', 'Юлия', 'Яна',
      'Аня', 'Света', 'Катя', 'Лена', 'Оля', 'Рита', 'Юля'
    ],
    surnames: {
      masculine: [
        'Отвёрткин', 'Шляпин', 'Техдолгов', 'Багов', 'Кофейников', 'Дедлайнов', 'Пиксельников',
        'Табличкин', 'Деплоев', 'Хотфиксов', 'Патчев', 'Коммитов', 'Задачкин', 'Спринтов',
        'Брифов', 'Скриншотов', 'Кнопкин', 'Клавишин', 'Тестов', 'Понедельников', 'Чайников',
        'Стикеров', 'Прототипов', 'Митингов', 'Прокрастинов', 'Релизов', 'Бюджетов', 'Фичеров',
        'Рефакторов', 'Пиксель', 'Багфиксин', 'Планёров', 'Макетников', 'Календарев', 'Курсоров',
        'Архивов', 'Папкин', 'Серверов', 'Терминалов', 'Кабельников', 'Логов', 'Дашбордов',
        'Мержев', 'Веткаев', 'Тасков', 'Роадмапов', 'Созвонов', 'Чеклистов', 'Бэкапов',
        'Табов', 'Релизников', 'Пингвинов', 'План-Бов', 'Брейнштормов', 'Пулреквестов',
        'Данных', 'Скриптов', 'Кнопарёв', 'Кофепейкин', 'Запасных'
      ],
      feminine: [
        'Отвёрткина', 'Шляпина', 'Техдолгова', 'Багова', 'Кофейникова', 'Дедлайнова', 'Пиксельникова',
        'Табличкина', 'Деплоева', 'Хотфиксова', 'Патчева', 'Коммитова', 'Задачкина', 'Спринтова',
        'Брифова', 'Скриншотова', 'Кнопкина', 'Клавишина', 'Тестова', 'Понедельникова', 'Чайникова',
        'Стикерова', 'Прототипова', 'Митингова', 'Прокрастинова', 'Релизова', 'Бюджетова', 'Фичерова',
        'Рефакторова', 'Пиксель', 'Багфиксина', 'Планёрова', 'Макетникова', 'Календарева', 'Курсорова',
        'Архивова', 'Папкина', 'Серверова', 'Терминалова', 'Кабельникова', 'Логова', 'Дашбордова',
        'Мержева', 'Веткаева', 'Таскова', 'Роадмапова', 'Созвонова', 'Чеклистова', 'Бэкапова',
        'Табова', 'Релизникова', 'Пингвинова', 'План-Бова', 'Брейнштормова', 'Пулреквестова',
        'Данных', 'Скриптова', 'Кнопарёва', 'Кофепейкина', 'Запасная'
      ]
    },
    nicknames: [
      'Пиксель', 'Кофе', 'Патч', 'Фикс', 'План Б', 'Скрепка', 'Хотфикс', 'Табличка',
      'Кнопка', 'Спринт', 'Бэкап', 'Бриф', 'Шорткат', 'Тихий релиз', 'Микроменеджер', 'Понедельник'
    ]
  };

  const SPRITE_INDICES = Object.freeze({
    female: Object.freeze([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]),
    male: Object.freeze([1, 3, 5, 7, 9, 11, 13, 15, 17, 19])
  });
  const normalize = value => String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е').replace(/\s+/gu, ' ');
  const baseName = value => String(value || '').replace(/\s+«[^»]*»$/u, '').trim();
  const genderIndex = new Map([
    ...CONFIG.masculineNames.map(name => [normalize(name), 'male']),
    ...CONFIG.feminineNames.map(name => [normalize(name), 'female'])
  ]);
  const validGender = value => value === 'male' || value === 'female';

  function genderForName(name) {
    return genderIndex.get(normalize(baseName(name)).split(' ')[0]) || null;
  }

  // Общие для клиента и сервера правила восстановления внешности старых персонажей.
  function resolveIdentity(person = {}) {
    const id = Number.isInteger(person.id) && person.id >= 0 ? person.id : 0;
    const look = person.appearance && typeof person.appearance === 'object' ? person.appearance : {};
    const savedSprite = Number.isInteger(look.sprite) && look.sprite >= 0 && look.sprite < 20 ? look.sprite : null;
    const gender = validGender(person.gender) ? person.gender : genderForName(person.name)
      || ((savedSprite === null ? id : savedSprite) % 2 ? 'male' : 'female');
    const appearance = {
      hair: Number.isInteger(look.hair) && look.hair >= 0 && look.hair < 64 ? look.hair : (id * 37 + 11) % 64,
      cloth: Number.isInteger(look.cloth) && look.cloth >= 0 && look.cloth < 4 ? look.cloth : (id * 3 + 1) % 4
    };
    const original = savedSprite === null ? (appearance.hair * 3 + appearance.cloth) % 10 : savedSprite;
    const allowed = SPRITE_INDICES[gender];
    const sameSheet = original < 10 ? allowed.slice(0, 5) : allowed.slice(5);
    appearance.sprite = allowed.includes(original) ? original : sameSheet[original % sameSheet.length];
    return { gender, appearance };
  }
  const randomItem = array => array[Math.floor(Math.random() * array.length)];
  const pickUniqueSet = names => {
    const exact = new Set();
    const bases = new Set();
    for (const value of names || []) {
      const full = normalize(value);
      if (!full) continue;
      exact.add(full);
      bases.add(normalize(baseName(value)));
    }
    return { exact, bases };
  };

  function formatName(firstName, surname, used, includeNickname) {
    const base = `${firstName} ${surname}`;
    if (used.bases.has(normalize(base)) || used.exact.has(normalize(base))) return null;

    if (includeNickname && Math.random() < CONFIG.nicknameChance) {
      const nickname = randomItem(CONFIG.nicknames);
      const decorated = `${base} «${nickname}»`;
      if (decorated.length <= CONFIG.maxLength && !used.exact.has(normalize(decorated))) return decorated;
    }
    return base.length <= CONFIG.maxLength ? base : null;
  }

  function generate(usedNames = [], gender = null) {
    const used = pickUniqueSet(usedNames);
    const groups = [
      { gender: 'male', names: CONFIG.masculineNames, surnames: CONFIG.surnames.masculine },
      { gender: 'female', names: CONFIG.feminineNames, surnames: CONFIG.surnames.feminine }
    ].filter(group => !validGender(gender) || group.gender === gender);

    // Random attempts keep the list varied; the exhaustive fallback prevents collisions.
    for (let attempt = 0; attempt < 180; attempt++) {
      const group = randomItem(groups);
      const first = randomItem(group.names);
      const surname = randomItem(group.surnames);
      const result = formatName(first, surname, used, true);
      if (result) return result;
    }

    for (const group of groups) {
      for (const first of group.names) {
        for (const surname of group.surnames) {
          const result = formatName(first, surname, used, false);
          if (result) return result;
        }
      }
    }

    // Практически недостижимо, но остаётся гарантированно уникальный запасной вариант.
    let number = 1;
    while (used.exact.has(normalize(`Сотрудник №${number}`))) number++;
    return `Сотрудник №${number}`;
  }

  const api = Object.freeze({ CONFIG, SPRITE_INDICES, generate, normalize, genderForName, resolveIdentity });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StartupNameGenerator = api;
})(typeof window !== 'undefined' ? window : globalThis);
