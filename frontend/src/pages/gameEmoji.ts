/**
 * A picture for a game, chosen from its own name.
 *
 * Cards used to take an emoji by list position, so the same game changed face
 * depending on which filter you were looking through — and a taco game could
 * come up as a chess piece. Now the title is searched for something recognisable
 * first, the category answers for anything the title does not, and only a title
 * that matches neither falls back to a generic tile. The fallback is picked by
 * hashing the title, so a game keeps the same face wherever it appears.
 *
 * Matching is first-match-wins, so the list is ordered specific before generic:
 * "sushi" has to be tried before "dice", or Sushi Dice comes out as dice.
 *
 * A Latin keyword has to sit on a word boundary, or "what" becomes a hat and
 * "FriendShip" a boat. A trailing plural still counts ("Kings Gold", "Cards
 * Against Humanity"), and a keyword long enough to be unmistakable is allowed
 * to appear inside a longer word. Arabic keywords are matched as plain
 * substrings, because the language attaches its articles and pronouns directly
 * to the word — يالنكتة is نكتة with both ends occupied.
 */

// Longest and most distinctive first — the list is scanned in order.
const BY_KEYWORD: [needle: string, emoji: string][] = [
  // Titles that would otherwise be read wrong by a shorter keyword below.
  ['friendship', '🤝'], ['battleship', '🚢'], ['lifeboat', '🛟'], ['catan', '🏝️'],
  ['pandemic', '🦠'], ['pandamic', '🦠'], ['viking', '🪓'], ['codenames', '🔐'],
  ['spotlight', '🔦'], ['dogfight', '✈️'], ['timeline', '⏳'], ['werewolf', '🐺'],
  ['farmer', '🚜'], ['cupcake', '🧁'], ['fishy', '🐟'], ['bandido', '🤠'],
  // Food
  ['sushi', '🍣'], ['taco', '🌮'], ['pizza', '🍕'], ['burger', '🍔'], ['برجر', '🍔'],
  ['cheese', '🧀'], ['barbecu', '🍖'], ['bbq', '🍖'], ['candy', '🍬'], ['cake', '🍰'],
  ['coffee', '☕'], ['قهوة', '☕'], ['ice cream', '🍦'], ['jelly', '🍮'], ['fruit', '🍓'],
  // Creatures
  ['ghost', '👻'], ['شبح', '👻'], ['zombie', '🧟'], ['vampire', '🧛'], ['monster', '👹'],
  ['وحوش', '👹'], ['dragon', '🐉'], ['rhino', '🦏'], ['beaver', '🦫'], ['shark', '🦈'],
  ['cobra', '🐍'], ['snake', '🐍'], ['حية', '🐍'], ['cat', '🐱'], ['قطة', '🐱'],
  ['dog', '🐶'], ['كلب', '🐶'], ['wolf', '🐺'], ['ذيب', '🐺'], ['ذئب', '🐺'],
  ['raven', '🐦'], ['bird', '🐦'], ['chicky', '🐤'], ['chicken', '🐔'], ['دجاج', '🐔'],
  ['horse', '🐴'], ['bee', '🐝'], ['hive', '🐝'], ['fish', '🐟'], ['سمك', '🐟'],
  ['t-rex', '🦖'], ['dino', '🦕'], ['unicorn', '🦄'], ['panda', '🐼'], ['bear', '🐻'],
  // People and roles
  ['sherlock', '🕵️'], ['detective', '🕵️'], ['agent', '🕵️'], ['spy', '🕵️'],
  ['جاسوس', '🕵️'], ['traitor', '🗡️'], ['خيانة', '🗡️'], ['mafia', '🕴️'], ['مافيا', '🕴️'],
  ['thief', '🦝'], ['حرامي', '🦝'], ['bandi', '🤠'], ['cowboy', '🤠'], ['pirate', '🏴‍☠️'],
  ['قرصان', '🏴‍☠️'], ['ninja', '🥷'], ['hero', '🦸'], ['بطل', '🦸'], ['ابطال', '🦸'],
  ['doctor', '🩺'], ['طبيب', '🩺'], ['chef', '👨‍🍳'], ['طباخ', '👨‍🍳'], ['farm', '🚜'],
  ['مزرعة', '🚜'], ['king', '👑'], ['ملك', '👑'], ['queen', '👑'], ['prince', '👑'],
  ['emperor', '👑'], ['knight', '🛡️'], ['فارس', '🛡️'],
  // Places and things
  ['castle', '🏰'], ['قلعة', '🏰'], ['tower', '🗼'], ['برج', '🗼'], ['island', '🏝️'],
  ['جزيرة', '🏝️'], ['city', '🏙️'], ['مدينة', '🏙️'], ['avenue', '🏙️'], ['york', '🗽'],
  ['port', '⚓'], ['ship', '🚢'], ['boat', '🚢'], ['سفينة', '🚢'], ['train', '🚂'],
  ['قطار', '🚂'], ['rocket', '🚀'], ['space', '🪐'], ['فضاء', '🪐'], ['moon', '🌙'],
  ['قمر', '🌙'], ['star', '⭐'], ['نجم', '⭐'], ['night', '🌃'], ['ليل', '🌃'],
  ['jungle', '🌴'], ['غابة', '🌴'], ['forest', '🌲'], ['desert', '🏜️'], ['صحراء', '🏜️'],
  ['labyrinth', '🌀'], ['متاهة', '🌀'], ['maze', '🌀'], ['cities', '🏛️'], ['museum', '🏛️'],
  // Objects and ideas
  ['skull', '💀'], ['جمجمة', '💀'], ['diamond', '💎'], ['ماس', '💎'], ['gold', '🪙'],
  ['ذهب', '🪙'], ['cash', '💰'], ['money', '💰'], ['بيزة', '💰'], ['فلوس', '💰'],
  ['sale', '🏷️'], ['deal', '🤝'], ['gun', '🔫'], ['شرطة', '🚓'], ['battle', '⚔️'],
  ['war', '⚔️'], ['حرب', '⚔️'], ['عسكري', '⚔️'], ['fire', '🔥'], ['نار', '🔥'],
  ['bomb', '💣'], ['قنبلة', '💣'], ['key', '🔑'], ['مفتاح', '🔑'], ['code', '🔐'],
  ['secret', '🤫'], ['سر', '🤫'], ['love', '💌'], ['حب', '💌'], ['heart', '❤️'],
  ['قلب', '❤️'], ['rose', '🌹'], ['وردة', '🌹'], ['brain', '🧠'], ['mind', '🧠'],
  ['عقل', '🧠'], ['معرفة', '🧠'], ['logic', '🔢'], ['منطق', '🔢'], ['math', '🔢'],
  ['حساب', '🔢'], ['time', '⏳'], ['وقت', '⏳'], ['second', '⏱️'], ['ثانية', '⏱️'],
  ['speed', '⚡'], ['سرعة', '⚡'], ['blitz', '⚡'], ['flash', '⚡'], ['story', '📖'],
  ['قصة', '📖'], ['fiction', '📖'], ['book', '📖'], ['كتاب', '📖'], ['word', '🔤'],
  ['كلمة', '🔤'], ['كلم', '🔤'], ['حرف', '🔤'], ['letter', '🔤'], ['color', '🎨'],
  ['hues', '🎨'], ['لون', '🎨'], ['ألوان', '🎨'], ['music', '🎵'], ['song', '🎵'],
  ['صوت', '🔊'], ['نكتة', '😂'], ['ضحك', '😂'], ['joke', '😂'], ['funny', '😂'],
  ['party', '🎉'], ['حفلة', '🎉'], ['vote', '🗳️'], ['تصويت', '🗳️'], ['truth', '🎭'],
  ['dare', '🎭'], ['bluff', '🎭'], ['lie', '🎭'], ['كذب', '🎭'], ['تحدي', '🏆'],
  ['challenge', '🏆'], ['champion', '🏆'], ['dice', '🎲'], ['نرد', '🎲'], ['card', '🃏'],
  ['ورق', '🃏'], ['puzzle', '🧩'], ['tile', '🧩'], ['stone', '🪨'], ['حجر', '🪨'],
  ['block', '🧱'], ['tower of', '🧱'], ['chess', '♟️'], ['شطرنج', '♟️'], ['hat', '🎩'],
  ['ring', '💍'], ['spot', '👁️'], ['guess', '❓'], ['خمن', '❓'], ['سؤال', '❓'],
  ['شنو', '❓'], ['من صجك', '❓'], ['who', '❓'], ['منو', '❓'], ['taboo', '🤐'],
  ['تابو', '🤐'], ['ghost blitz', '👻'], ['effect', '🧪'], ['lab', '🧪'], ['كيمياء', '🧪'],
];

// Every category has a face, so the fallback below is genuinely a last resort.
const BY_CATEGORY: Record<string, string> = {
  '2 Players': '♟️',
  Bluffing: '🎭',
  Challenge: '🏆',
  Chat: '💬',
  'Dare to Discover': '🔍',
  Dexterity: '🤹',
  Family: '👨‍👩‍👧',
  'Fast & Fun': '⚡',
  Hard: '🧠',
  Kids: '🧸',
  New: '✨',
  'Party Games': '🎉',
  'Smart or Lucky': '🍀',
  'Take That': '🎯',
  VIP: '👑',
};

const GENERIC = ['🎲', '♟️', '🃏', '🧩', '🎯', '🀄'];

/** Stable across renders, filters and reloads: the same title always hashes the
 *  same way, so a card never changes face while the customer is looking at it. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const LATIN = /^[a-z0-9 '&.-]+$/;

/** Does this keyword genuinely appear in the title, as a word rather than as
 *  letters swallowed by a longer one? */
function appearsIn(title: string, needle: string): boolean {
  // Arabic attaches prefixes and suffixes, so a boundary test would reject
  // every real match. A plain substring is the correct rule there.
  if (!LATIN.test(needle)) return title.includes(needle);
  for (let from = 0; ; ) {
    const at = title.indexOf(needle, from);
    if (at === -1) return false;
    const startsWord = at === 0 || !/[a-z]/.test(title[at - 1]);
    const rest = title.slice(at + needle.length);
    const endsWord = !/^[a-z]/.test(rest) || /^s(?![a-z])/.test(rest) || needle.length >= 6;
    if (startsWord && endsWord) return true;
    from = at + 1;
  }
}

export function gameEmoji(title: string, category: string): string {
  const t = title.toLowerCase();
  for (const [needle, emoji] of BY_KEYWORD) if (appearsIn(t, needle)) return emoji;
  return BY_CATEGORY[category] ?? GENERIC[hash(title) % GENERIC.length];
}
