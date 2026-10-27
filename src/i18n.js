// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They never
// quote a free text of the Eco-Devices: only our own words, error codes and
// the numbers we checked. Never the login.
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const hours = (ms) => Math.max(1, Math.round(ms / 3_600_000));
export const delay = (ms) => {
  if (ms >= 2 * 3_600_000) return { en: `${hours(ms)} h`, fr: `${hours(ms)} h` };
  // Rounded first: 59.99 s is told "1 min", never "60 s".
  if (Math.round(ms / 1000) >= 60) return { en: `${minutes(ms)} min`, fr: `${minutes(ms)} min` };
  return { en: `${seconds(ms)} s`, fr: `${seconds(ms)} s` };
};

/** Our words for an error code of src/ecodevices/client.js. */
const REASON = {
  timeout: { en: 'no answer', fr: 'pas de réponse' },
  unreachable: { en: 'unreachable', fr: 'injoignable' },
  http: { en: 'HTTP error', fr: 'erreur HTTP' },
  redirect: {
    en: 'redirect refused (is it the Eco-Devices?)',
    fr: 'redirection refusée (est-ce bien l’Eco-Devices ?)',
  },
  not_found: {
    en: 'no JSON API at this address (is it an Eco-Devices, with a recent firmware?)',
    fr: 'pas d’API JSON à cette adresse (est-ce bien un Eco-Devices, avec un firmware récent ?)',
  },
  server: { en: 'error of the Eco-Devices', fr: 'erreur de l’Eco-Devices' },
  rate_limited: { en: 'too many requests', fr: 'trop de requêtes' },
  refused: { en: 'login refused', fr: 'identifiants refusés' },
  too_large: { en: 'answer too large', fr: 'réponse trop grande' },
  not_json: { en: 'answer that is not data', fr: 'réponse qui n’est pas une donnée' },
  unknown_answer: {
    en: 'not an answer of an Eco-Devices (the Eco-Devices RT2 is not supported)',
    fr: 'ce n’est pas une réponse d’un Eco-Devices (l’Eco-Devices RT2 n’est pas pris en charge)',
  },
};

export function reason(err) {
  const text = REASON[err?.code] ?? { en: 'unexpected error', fr: 'erreur inattendue' };
  const status =
    (err?.code === 'http' || err?.code === 'server') && Number.isInteger(err.status)
      ? ` ${err.status}`
      : '';
  return { en: `${text.en}${status}`, fr: `${text.fr}${status}` };
}

const num = (value) => Math.round(value * 1000) / 1000;
const list = (items) => items.join(', ');

/** The name of an input, as the devices are named. */
const INPUT = {
  t1: { en: 'teleinfo 1', fr: 'téléinfo 1' },
  t2: { en: 'teleinfo 2', fr: 'téléinfo 2' },
  c1: { en: 'counter 1', fr: 'compteur 1' },
  c2: { en: 'counter 2', fr: 'compteur 2' },
};
const inputs = (lang, items) => list(items.map((i) => INPUT[i][lang]));

/** `ago` ms ago, or undefined for a read made by this click. */
const when = (ago) =>
  ago === undefined
    ? { en: 'Read now', fr: 'Lu à l’instant' }
    : { en: `Last read ${delay(ago).en} ago`, fr: `Dernière lecture il y a ${delay(ago).fr}` };

const join = (lang, first, notes) => [first[lang], ...notes.map((n) => n[lang])].join(' ');
const withNotes = (first, notes) => ({
  en: join('en', first, notes),
  fr: join('fr', first, notes),
});

/** The next read, or nothing when no read is planned (a refused login). */
const nextRead = (next) =>
  next === undefined
    ? { en: '', fr: '' }
    : { en: ` Next read in ${delay(next).en}.`, fr: ` Prochaine lecture dans ${delay(next).fr}.` };

/** A held value in words; only an electricity jump says what it would bill. */
const heldText = (lang, { input, direction, from, to, unit }) => {
  const name = INPUT[input][lang];
  const counted = unit === 'kWh';
  if (lang === 'en') {
    return direction === 'down'
      ? `${name} dropped from ${num(from)} to ${num(to)} ${unit}`
      : `${name} jumped from ${num(from)} to ${num(to)} ${unit}${counted ? ` (${num(to - from)} kWh would be counted at once as consumption)` : ''}`;
  }
  return direction === 'down'
    ? `${name} a baissé de ${num(from)} à ${num(to)} ${unit}`
    : `${name} a sauté de ${num(from)} à ${num(to)} ${unit}${counted ? ` (${num(to - from)} kWh seraient comptés d’un coup comme consommation)` : ''}`;
};

/** A drop of a teleinfo total: never accepted; why, and what the way out costs. */
const DROP_HELP = {
  en: 'A drop of a teleinfo consumption index is never accepted: it comes from another meter on the input (a meter replaced) or a change of tariff option that started its indexes again. The only way out is to delete the device of that input and create it again from the "Discover" tab: its history (index, power, consumption and cost of the energy monitoring) is lost and it must be placed again in the energy tree; Gladys may refuse to delete a device with more than 5000 states (it purges them in the background: try again later).',
  fr: 'Une baisse de l’index de consommation d’une entrée téléinfo n’est jamais acceptée : elle vient d’un autre compteur sur l’entrée (compteur remplacé) ou d’un changement d’option tarifaire qui a remis ses index à zéro. La seule sortie est de supprimer l’appareil de cette entrée puis de le recréer depuis l’onglet « Découverte » : son historique (index, puissance, consommation et coût du suivi énergétique) est perdu et il faut le replacer dans l’arbre énergie ; Gladys peut refuser de supprimer un appareil de plus de 5000 états (il les purge en arrière-plan : réessayez plus tard).',
};

/** Whether a held value is a teleinfo drop (never accepted). */
const isFinalDrop = (h) => h.direction === 'down' && h.unit === 'kWh';

export const T = {
  incomplete: {
    en: 'Enter the address of your Eco-Devices (its IP address on your network, e.g. 192.168.1.20).',
    fr: 'Saisissez l’adresse de votre Eco-Devices (son adresse IP sur votre réseau, ex. 192.168.1.20).',
  },
  badAddress: {
    en: 'The Eco-Devices address is not valid: enter an IP address or a host name, with an optional port (e.g. 192.168.1.20).',
    fr: 'L’adresse de l’Eco-Devices n’est pas valide : saisissez une adresse IP ou un nom d’hôte, avec un port éventuel (ex. 192.168.1.20).',
  },
  credentialsInAddress: {
    en: 'The Eco-Devices address holds a user name and password ("user:password@"): enter only the IP address here, and the login in the "User name" and "Password" fields.',
    fr: 'L’adresse de l’Eco-Devices contient un nom d’utilisateur et un mot de passe (« utilisateur:motdepasse@ ») : saisissez ici seulement l’adresse IP, et les identifiants dans les champs « Nom d’utilisateur » et « Mot de passe ».',
  },
  /** The badge of a device whose index is held. */
  badge: (h) =>
    isFinalDrop(h)
      ? {
          en: `Index held: ${heldText('en', h)}, never accepted (see the integration status).`,
          fr: `Index retenu : ${heldText('fr', h)}, baisse jamais acceptée (voir l’état de l’intégration).`,
        }
      : {
          en: `Index held: ${heldText('en', h)} ("Accept the held index", two clicks).`,
          fr: `Index retenu : ${heldText('fr', h)} (« Accepter l’index retenu », deux clics).`,
        },
  badLogin: {
    en: 'The login is incomplete or not valid: fill both the user name (without ":") and the password, or leave both empty.',
    fr: 'Les identifiants sont incomplets ou invalides : remplissez le nom d’utilisateur (sans « : ») et le mot de passe, ou laissez les deux vides.',
  },
  configUnread: (wait) => ({
    en: `The configuration of the integration could not be read from Gladys: new try in ${delay(wait).en}.`,
    fr: `La configuration de l’intégration n’a pas pu être lue depuis Gladys : nouvel essai dans ${delay(wait).fr}.`,
  }),
  /** The Eco-Devices refused the login on its main page: no read until it changes. */
  refused: (address, hasLogin, notes = []) =>
    withNotes(
      hasLogin
        ? {
            en: `The Eco-Devices at ${address} refuses this login: reads stopped. Correct the user name or the password and save, or click "Test the connection" to try once more.`,
            fr: `L’Eco-Devices à l’adresse ${address} refuse ces identifiants : lectures arrêtées. Corrigez le nom d’utilisateur ou le mot de passe et enregistrez, ou cliquez sur « Tester la connexion » pour réessayer une fois.`,
          }
        : {
            en: `The Eco-Devices at ${address} asks for a login (secure access is on): reads stopped. Enter the user name and password of its web interface and save.`,
            fr: `L’Eco-Devices à l’adresse ${address} demande des identifiants (accès sécurisé activé) : lectures arrêtées. Saisissez le nom d’utilisateur et le mot de passe de son interface web et enregistrez.`,
          },
      notes,
    ),
  unreachable: (address, err, wait, notes = []) =>
    withNotes(
      {
        en: `The Eco-Devices at ${address} could not be read (${reason(err).en}): new try in ${delay(wait).en}.`,
        fr: `L’Eco-Devices à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}) : nouvel essai dans ${delay(wait).fr}.`,
      },
      notes,
    ),
  /** HTTP 429 or 5xx: a pause, kept across restarts. */
  paused: (address, err, wait, notes = []) =>
    withNotes(
      {
        en: `The Eco-Devices at ${address} asks to wait (${reason(err).en}): reads paused, new try in ${delay(wait).en}.`,
        fr: `L’Eco-Devices à l’adresse ${address} demande d’attendre (${reason(err).fr}) : lectures en pause, nouvel essai dans ${delay(wait).fr}.`,
      },
      notes,
    ),
  waiting: (address, notes = []) =>
    withNotes(
      {
        en: `Waiting for the first answer of the Eco-Devices at ${address}.`,
        fr: `En attente de la première réponse de l’Eco-Devices à l’adresse ${address}.`,
      },
      notes,
    ),
  /** `teleinfo`: the connected teleinfo inputs; `counters`: the pulse counters set. */
  ok: (address, teleinfo, counters, notes = []) => {
    const read = [...teleinfo, ...counters];
    return withNotes(
      read.length > 0
        ? {
            en: `Connected to the Eco-Devices (${address}): ${inputs('en', read)}.`,
            fr: `Connecté à l’Eco-Devices (${address}) : ${inputs('fr', read)}.`,
          }
        : {
            en: `Connected to the Eco-Devices (${address}), but no meter shows on its teleinfo inputs and no pulse counter is set in this configuration.`,
            fr: `Connecté à l’Eco-Devices (${address}), mais aucun compteur ne se montre sur ses entrées téléinfo et aucun compteur d’impulsions n’est réglé dans cette configuration.`,
          },
      notes,
    );
  },
  notes: {
    noDevice: (items) => ({
      en: `Create the device of ${inputs('en', items)} from the "Discover" tab to receive its values.`,
      fr: `Créez l’appareil de ${inputs('fr', items)} depuis l’onglet « Découverte » pour recevoir ses valeurs.`,
    }),
    ambiguous: (items) => ({
      en: `${inputs('en', items)}: indexes of two tariff options at once, no consumption index (power only).`,
      fr: `${inputs('fr', items)} : des index de deux options tarifaires à la fois, pas d’index de consommation (puissance seulement).`,
    }),
    /** `items`: `[{ input, keys }]`, the keys of its option the answer does not give. */
    incomplete: (items) => ({
      en: `${items.map((i) => `${INPUT[i.input].en}: the answer gives no ${i.keys.join(', ')}`).join('; ')}, so no consumption index (power only). Please send the answer of http://<address>/api/xdevices.json?cmd=10 to the developer of the integration.`,
      fr: `${items.map((i) => `${INPUT[i.input].fr} : la réponse ne donne pas ${i.keys.join(', ')}`).join(' ; ')}, donc pas d’index de consommation (puissance seulement). Merci d’envoyer la réponse de http://<adresse>/api/xdevices.json?cmd=10 au développeur de l’intégration.`,
    }),
    noIndex: (items) => ({
      en: `${inputs('en', items)}: no complete tariff index this time (a missing or glitching index), no consumption index sent.`,
      fr: `${inputs('fr', items)} : pas d’index tarifaire complet cette fois (un index absent ou incohérent), aucun index de consommation envoyé.`,
    }),
    frozen: (items, after) => ({
      en: `The values of ${inputs('en', items)} have not changed for ${delay(after).en} or more (teleinfo cable out?): the power is no longer sent.`,
      fr: `Les valeurs de ${inputs('fr', items)} n’ont pas changé depuis ${delay(after).fr} ou plus (câble téléinfo débranché ?) : la puissance n’est plus envoyée.`,
    }),
    counterUnset: (items) => ({
      en: `${inputs('en', items)} counts pulses but is not set: choose water or gas in the configuration to see it.`,
      fr: `${inputs('fr', items)} compte des impulsions mais n’est pas réglé : choisissez eau ou gaz dans la configuration pour le voir.`,
    }),
    counterSilent: (items) => ({
      en: `${inputs('en', items)}: no index above 0 on the Eco-Devices yet (enter the index of the meter in its configuration page).`,
      fr: `${inputs('fr', items)} : pas encore d’index au-dessus de 0 sur l’Eco-Devices (saisissez l’index du compteur dans sa page de configuration).`,
    }),
    dailyFailed: (daily) => ({
      en: `The consumption of the day could not be read (${reason(daily).en}): the indexes go on, new try later.`,
      fr: `La consommation du jour n’a pas pu être lue (${reason(daily).fr}) : les index continuent, nouvel essai plus tard.`,
    }),
    storeUnreadable: (code) => ({
      en: `The state file in /data cannot be read (${code}): no index is sent until it reads again (a held value may be in it); the power goes on.`,
      fr: `Le fichier d’état dans /data ne peut pas être lu (${code}) : aucun index n’est envoyé tant qu’il ne se relit pas (une valeur retenue peut s’y trouver) ; la puissance continue.`,
    }),
    saveFailed: {
      en: 'The state file in /data cannot be written: no index is sent until it can (Gladys never gets an index the file does not know).',
      fr: 'Le fichier d’état dans /data ne peut pas être écrit : aucun index n’est envoyé tant qu’il ne peut pas l’être (Gladys ne reçoit jamais un index que le fichier ne connaît pas).',
    },
    /** Every index held, `{ input, direction, from, to, unit }`. */
    held: (held) => {
      const final = held.filter(isFinalDrop);
      const open = held.filter((h) => !isFinalDrop(h));
      const en = [];
      const fr = [];
      if (final.length > 0) {
        en.push(
          `Consumption index DROP held, never accepted (the last accepted value is sent again): ${final.map((h) => heldText('en', h)).join('; ')}. ${DROP_HELP.en}`,
        );
        fr.push(
          `BAISSE d’index de consommation retenue, jamais acceptée (la dernière valeur acceptée est renvoyée) : ${final.map((h) => heldText('fr', h)).join(' ; ')}. ${DROP_HELP.fr}`,
        );
      }
      if (open.length > 0) {
        en.push(
          `Index held back (the last accepted value is sent again): ${open.map((h) => heldText('en', h)).join('; ')}. If it is right, click "Accept the held index" twice in the configuration of the integration (the first click lists, the second accepts what was listed). Saving the configuration accepts nothing.`,
        );
        fr.push(
          `Index retenu (la dernière valeur acceptée est renvoyée) : ${open.map((h) => heldText('fr', h)).join(' ; ')}. Si c’est juste, cliquez deux fois sur « Accepter l’index retenu » dans la configuration de l’intégration (le premier clic liste, le second accepte ce qui a été listé). Enregistrer la configuration n’accepte rien.`,
        );
      }
      return { en: en.join(' '), fr: fr.join(' ') };
    },
  },
  accept: {
    nothing: {
      en: 'No index is held back: nothing to accept.',
      fr: 'Aucun index n’est retenu : rien à accepter.',
    },
    dropsOnly: (drops) => ({
      en: `Only teleinfo drops are held (${drops.map((h) => heldText('en', h)).join('; ')}): nothing to accept. ${DROP_HELP.en}`,
      fr: `Seules des baisses téléinfo sont retenues (${drops.map((h) => heldText('fr', h)).join(' ; ')}) : rien à accepter. ${DROP_HELP.fr}`,
    }),
    /** The first click: what a second click would accept. */
    confirm: (jumps, drops, within) => ({
      en: `A second click accepts these values, plus what each meter may measure between the two clicks: ${jumps.map((h) => heldText('en', h)).join('; ')}. Click "Accept the held index" again, after a few seconds and within ${delay(within).en}; accept only if they are right.${drops.length > 0 ? ` ${DROP_HELP.en}` : ''}`,
      fr: `Un second clic accepte ces valeurs, plus ce que chaque compteur a pu mesurer entre les deux clics : ${jumps.map((h) => heldText('fr', h)).join(' ; ')}. Cliquez de nouveau sur « Accepter l’index retenu », après quelques secondes et dans les ${delay(within).fr} ; n’acceptez que si elles sont justes.${drops.length > 0 ? ` ${DROP_HELP.fr}` : ''}`,
    }),
    /** The second click: what was taken, what changed since the first. */
    done: (accepted, changed, drops) => {
      const parts = { en: [], fr: [] };
      for (const { input, to, unit } of accepted) {
        parts.en.push(
          `Accepted: ${INPUT[input].en}, index ${num(to)} ${unit}, sent at the next read.`,
        );
        parts.fr.push(
          `Accepté : ${INPUT[input].fr}, index ${num(to)} ${unit}, envoyé à la prochaine lecture.`,
        );
      }
      if (changed.length > 0) {
        const names = changed.map((h) => h.input);
        parts.en.push(
          `Not accepted, the value changed since the first click: ${inputs('en', names)}. Click again to list it.`,
        );
        parts.fr.push(
          `Non accepté, la valeur a changé depuis le premier clic : ${inputs('fr', names)}. Cliquez de nouveau pour la lister.`,
        );
      }
      if (drops.length > 0) {
        parts.en.push(DROP_HELP.en);
        parts.fr.push(DROP_HELP.fr);
      }
      return { en: parts.en.join(' '), fr: parts.fr.join(' ') };
    },
  },
  test: {
    /** The outcome of a read: `[{ input, power, index, held, unit }]`. */
    reading: (items, ago, next) => {
      const one = (lang, i) => {
        const power = i.input.startsWith('t')
          ? `${i.power === undefined ? '?' : `${i.power} VA`}, `
          : '';
        const held = i.held ? (lang === 'en' ? ' (held back)' : ' (retenu)') : '';
        const index = i.index === undefined ? '?' : `${num(i.index)} ${i.unit}${held}`;
        return `${INPUT[i.input][lang]} ${power}index ${index}`;
      };
      const none = { en: 'no meter on the inputs', fr: 'aucun compteur sur les entrées' };
      return {
        en: `${when(ago).en}: Eco-Devices, ${items.length ? items.map((i) => one('en', i)).join('; ') : none.en}.${nextRead(next).en}`,
        fr: `${when(ago).fr} : Eco-Devices, ${items.length ? items.map((i) => one('fr', i)).join(' ; ') : none.fr}.${nextRead(next).fr}`,
      };
    },
    failed: (address, err, ago, next) => ({
      en: `${when(ago).en}: the Eco-Devices at ${address} could not be read (${reason(err).en}).${nextRead(next).en}`,
      fr: `${when(ago).fr} : l’Eco-Devices à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}).${nextRead(next).fr}`,
    }),
    notYet: (next, interval) => ({
      en: `No read yet with this configuration: the first one comes in ${delay(next).en} (never more than one every ${delay(interval).en}).`,
      fr: `Pas encore de lecture avec cette configuration : la première vient dans ${delay(next).fr} (jamais plus d’une toutes les ${delay(interval).fr}).`,
    }),
    slow: {
      en: 'The Eco-Devices is slow to answer: look at the integration status in a minute.',
      fr: 'L’Eco-Devices tarde à répondre : regardez l’état de l’intégration dans une minute.',
    },
  },
};
