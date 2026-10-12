/**
 * Dataset de estrelas brilhantes e linhas de constelação.
 * Coordenadas: RA (horas decimais, 0-24), Dec (graus decimais, -90 a +90)
 * Magnitude aparente: quanto menor, mais brilhante.
 * Cores aproximadas baseadas no tipo espectral.
 */

// Cores por temperatura/espectral
const COLORS = {
  blue: '#c8e0ff',      // O/B types
  blueWhite: '#e0ecff', // A types
  white: '#fff8f0',     // F types
  yellowWhite: '#fff0d0', // G types
  orange: '#ffd8a0',    // K types
  red: '#ffb8a0',       // M types
};

export const BRIGHT_STARS = [
  // ===== CANIS MAJOR =====
  { id: 'sirius',     name: 'Sírius',        ra: 6.752,  dec: -16.716, mag: -1.46, color: COLORS.blueWhite },
  { id: 'mirzam',     name: 'Mirzam',        ra: 6.378,  dec: -17.957, mag: 1.98,  color: COLORS.blueWhite },
  { id: 'wezen',      name: 'Wezen',         ra: 7.140,  dec: -26.393, mag: 1.83,  color: COLORS.yellowWhite },
  { id: 'adhara',     name: 'Adhara',        ra: 6.977,  dec: -28.972, mag: 1.50,  color: COLORS.blue },
  { id: 'aludra',     name: 'Aludra',        ra: 7.407,  dec: -29.303, mag: 2.45,  color: COLORS.blue },

  // ===== CARINA =====
  { id: 'canopus',    name: 'Canopus',       ra: 6.399,  dec: -52.696, mag: -0.74, color: COLORS.yellowWhite },
  { id: 'miaplacidus',name: 'Miaplacidus',   ra: 9.220,  dec: -69.717, mag: 1.68,  color: COLORS.blueWhite },
  { id: 'avior',      name: 'Avior',         ra: 8.375,  dec: -59.509, mag: 1.86,  color: COLORS.orange },

  // ===== CENTAURUS =====
  { id: 'rigilkent',  name: 'Rigil Kentaurus', ra: 14.660, dec: -60.839, mag: -0.27, color: COLORS.yellowWhite },
  { id: 'hadar',      name: 'Hadar',         ra: 14.064, dec: -60.373, mag: 0.61,  color: COLORS.blueWhite },
  { id: 'menkent',    name: 'Menkent',       ra: 14.118, dec: -36.370, mag: 2.06,  color: COLORS.orange },

  // ===== CRUX =====
  { id: 'acrux',      name: 'Acrux',         ra: 12.443, dec: -63.099, mag: 1.33,  color: COLORS.blue },
  { id: 'mimosa',     name: 'Mimosa',        ra: 12.796, dec: -59.689, mag: 1.25,  color: COLORS.blue },
  { id: 'gacrux',     name: 'Gacrux',        ra: 12.519, dec: -57.113, mag: 1.64,  color: COLORS.red },
  { id: 'delta_cru',  name: 'δ Cru',         ra: 12.253, dec: -58.749, mag: 2.79,  color: COLORS.blueWhite },
  { id: 'epsilon_cru',name: 'ε Cru',         ra: 12.360, dec: -60.833, mag: 3.58,  color: COLORS.orange },

  // ===== ORION =====
  { id: 'betelgeuse', name: 'Betelgeuse',    ra: 5.919,  dec: 7.407,   mag: 0.50,  color: COLORS.red },
  { id: 'rigel',      name: 'Rigel',         ra: 5.242,  dec: -8.202,  mag: 0.13,  color: COLORS.blueWhite },
  { id: 'bellatrix',  name: 'Bellatrix',     ra: 5.419,  dec: 6.350,   mag: 1.64,  color: COLORS.blue },
  { id: 'mintaka',    name: 'Mintaka',       ra: 5.534,  dec: -0.299,  mag: 2.20,  color: COLORS.blue },
  { id: 'alnilam',    name: 'Alnilam',       ra: 5.604,  dec: -1.202,  mag: 1.69,  color: COLORS.blue },
  { id: 'alnitak',    name: 'Alnitak',       ra: 5.679,  dec: -1.943,  mag: 1.74,  color: COLORS.blue },
  { id: 'saiph',      name: 'Saiph',         ra: 5.796,  dec: -9.669,  mag: 2.07,  color: COLORS.blue },
  { id: 'meissa',     name: 'Meissa',        ra: 5.593,  dec: 9.934,   mag: 3.47,  color: COLORS.blueWhite },

  // ===== URSA MAJOR =====
  { id: 'dubhe',      name: 'Dubhe',         ra: 11.062, dec: 61.751,  mag: 1.79,  color: COLORS.orange },
  { id: 'merak',      name: 'Merak',         ra: 11.031, dec: 56.382,  mag: 2.37,  color: COLORS.blueWhite },
  { id: 'phecda',     name: 'Phecda',        ra: 11.897, dec: 53.695,  mag: 2.44,  color: COLORS.blueWhite },
  { id: 'megrez',     name: 'Megrez',        ra: 12.257, dec: 57.033,  mag: 3.32,  color: COLORS.white },
  { id: 'alioth',     name: 'Alioth',        ra: 12.900, dec: 55.960,  mag: 1.77,  color: COLORS.white },
  { id: 'mizar',      name: 'Mizar',         ra: 13.399, dec: 54.925,  mag: 2.23,  color: COLORS.white },
  { id: 'alkaid',     name: 'Alkaid',        ra: 13.792, dec: 49.313,  mag: 1.85,  color: COLORS.blueWhite },

  // ===== POLARIS / URSA MINOR =====
  { id: 'polaris',    name: 'Polaris',       ra: 2.530,  dec: 89.264,  mag: 1.98,  color: COLORS.yellowWhite },
  { id: 'kochab',     name: 'Kochab',        ra: 14.845, dec: 74.156,  mag: 2.07,  color: COLORS.orange },

  // ===== CASSIOPEIA =====
  { id: 'schedar',    name: 'Schedar',       ra: 0.675,  dec: 56.537,  mag: 2.24,  color: COLORS.orange },
  { id: 'caph',       name: 'Caph',          ra: 0.153,  dec: 59.150,  mag: 2.28,  color: COLORS.yellowWhite },
  { id: 'gamma_cas',  name: 'γ Cas',         ra: 0.945,  dec: 60.717,  mag: 2.15,  color: COLORS.blue },
  { id: 'ruchbah',    name: 'Ruchbah',       ra: 1.430,  dec: 60.235,  mag: 2.66,  color: COLORS.blueWhite },
  { id: 'epsilon_cas',name: 'ε Cas',         ra: 1.906,  dec: 63.670,  mag: 3.35,  color: COLORS.blueWhite },

  // ===== SCORPIUS =====
  { id: 'antares',    name: 'Antares',       ra: 16.490, dec: -26.432, mag: 1.06,  color: COLORS.red },
  { id: 'graffias',   name: 'Graffias',      ra: 16.090, dec: -19.806, mag: 2.55,  color: COLORS.blue },
  { id: 'dschubba',   name: 'Dschubba',      ra: 16.005, dec: -22.622, mag: 2.29,  color: COLORS.blue },
  { id: 'sargas',     name: 'Sargas',        ra: 17.623, dec: -42.998, mag: 1.86,  color: COLORS.yellowWhite },
  { id: 'shaula',     name: 'Shaula',        ra: 17.560, dec: -37.104, mag: 1.62,  color: COLORS.blue },
  { id: 'kappa_sco',  name: 'κ Sco',         ra: 17.708, dec: -39.030, mag: 2.39,  color: COLORS.blue },
  { id: 'lambda_sco', name: 'λ Sco',         ra: 17.633, dec: -37.096, mag: 1.62,  color: COLORS.blue },

  // ===== SAGITTARIUS =====
  { id: 'kaus_australis', name: 'Kaus Australis', ra: 18.403, dec: -34.385, mag: 1.85, color: COLORS.blueWhite },
  { id: 'nunki',      name: 'Nunki',         ra: 18.921, dec: -26.296, mag: 2.05,  color: COLORS.blueWhite },
  { id: 'kaus_media', name: 'Kaus Media',    ra: 18.350, dec: -29.830, mag: 2.70,  color: COLORS.orange },
  { id: 'kaus_borealis', name: 'Kaus Borealis', ra: 18.466, dec: -25.422, mag: 2.81, color: COLORS.orange },
  { id: 'ascella',    name: 'Ascella',       ra: 19.043, dec: -29.880, mag: 2.60,  color: COLORS.white },

  // ===== CANIS MINOR =====
  { id: 'procyon',    name: 'Procyon',       ra: 7.655,  dec: 5.225,   mag: 0.34,  color: COLORS.yellowWhite },
  { id: 'gomeisa',    name: 'Gomeisa',       ra: 7.451,  dec: 8.289,   mag: 2.89,  color: COLORS.blueWhite },

  // ===== CYGNUS =====
  { id: 'deneb',      name: 'Deneb',         ra: 20.690, dec: 45.280,  mag: 1.25,  color: COLORS.white },
  { id: 'sadr',       name: 'Sadr',          ra: 20.372, dec: 40.257,  mag: 2.23,  color: COLORS.yellowWhite },
  { id: 'albireo',    name: 'Albireo',       ra: 19.512, dec: 27.959,  mag: 3.05,  color: COLORS.orange },
  { id: 'delta_cyg',  name: 'δ Cyg',         ra: 19.749, dec: 45.131,  mag: 2.87,  color: COLORS.blueWhite },
  { id: 'epsilon_cyg',name: 'ε Cyg',         ra: 20.770, dec: 33.970,  mag: 2.48,  color: COLORS.orange },
  { id: 'zeta_cyg',   name: 'ζ Cyg',         ra: 21.216, dec: 30.227,  mag: 3.21,  color: COLORS.blueWhite },

  // ===== AQUILA =====
  { id: 'altair',     name: 'Altair',        ra: 19.846, dec: 8.868,   mag: 0.77,  color: COLORS.white },
  { id: 'tarazed',    name: 'Tarazed',       ra: 19.770, dec: 10.613,  mag: 2.72,  color: COLORS.orange },
  { id: 'alshain',    name: 'Alshain',       ra: 19.921, dec: 6.407,   mag: 3.71,  color: COLORS.yellowWhite },

  // ===== LYRA =====
  { id: 'vega',       name: 'Vega',          ra: 18.616, dec: 38.784,  mag: 0.03,  color: COLORS.white },
  { id: 'sheliak',    name: 'Sheliak',       ra: 18.833, dec: 33.363,  mag: 3.52,  color: COLORS.blue },
  { id: 'sulafat',    name: 'Sulafat',       ra: 18.986, dec: 32.689,  mag: 3.25,  color: COLORS.blueWhite },

  // ===== GEMINI =====
  { id: 'castor',     name: 'Castor',        ra: 7.576,  dec: 31.889,  mag: 1.58,  color: COLORS.white },
  { id: 'pollux',     name: 'Pólux',         ra: 7.755,  dec: 28.026,  mag: 1.14,  color: COLORS.orange },
  { id: 'alhena',     name: 'Alhena',        ra: 6.628,  dec: 16.399,  mag: 1.93,  color: COLORS.white },
  { id: 'wasat',      name: 'Wasat',         ra: 7.335,  dec: 21.982,  mag: 3.53,  color: COLORS.yellowWhite },
  { id: 'mebsuta',    name: 'Mebsuta',       ra: 6.732,  dec: 25.131,  mag: 3.06,  color: COLORS.yellowWhite },

  // ===== LEO =====
  { id: 'regulus',    name: 'Regulus',       ra: 10.140, dec: 11.967,  mag: 1.36,  color: COLORS.blueWhite },
  { id: 'algieba',    name: 'Algieba',       ra: 10.333, dec: 19.842,  mag: 2.01,  color: COLORS.orange },
  { id: 'denebola',   name: 'Denebola',      ra: 11.818, dec: 14.572,  mag: 2.14,  color: COLORS.white },
  { id: 'zosma',      name: 'Zosma',         ra: 11.235, dec: 20.524,  mag: 2.56,  color: COLORS.white },
  { id: 'aldebaran_leo', name: 'Adhafera',   ra: 10.279, dec: 23.417,  mag: 3.43,  color: COLORS.yellowWhite },

  // ===== ANDROMEDA =====
  { id: 'alpheratz',  name: 'Alpheratz',     ra: 0.140,  dec: 29.091,  mag: 2.06,  color: COLORS.blueWhite },
  { id: 'mirach',     name: 'Mirach',        ra: 1.162,  dec: 35.621,  mag: 2.05,  color: COLORS.red },
  { id: 'almach',     name: 'Almach',        ra: 2.065,  dec: 42.330,  mag: 2.10,  color: COLORS.orange },

  // ===== PEGASUS =====
  { id: 'markab',     name: 'Markab',        ra: 23.079, dec: 15.205,  mag: 2.49,  color: COLORS.blueWhite },
  { id: 'scheat',     name: 'Scheat',        ra: 23.063, dec: 28.083,  mag: 2.44,  color: COLORS.red },
  { id: 'algenib',    name: 'Algenib',       ra: 0.220,  dec: 15.184,  mag: 2.83,  color: COLORS.blueWhite },
  { id: 'enif',       name: 'Enif',          ra: 21.737, dec: 9.875,   mag: 2.38,  color: COLORS.orange },

  // ===== TAURUS =====
  { id: 'aldebaran',  name: 'Aldebaran',     ra: 4.599,  dec: 16.509,  mag: 0.85,  color: COLORS.orange },
  { id: 'elnath',     name: 'Elnath',        ra: 5.438,  dec: 28.608,  mag: 1.65,  color: COLORS.blueWhite },
  { id: 'theta_tau',  name: 'θ Tau',         ra: 4.478,  dec: 15.962,  mag: 3.84,  color: COLORS.white },
  { id: 'gamma_tau',  name: 'γ Tau',         ra: 4.330,  dec: 15.628,  mag: 3.65,  color: COLORS.white },
  { id: 'delta_tau',  name: 'δ Tau',         ra: 4.382,  dec: 17.542,  mag: 3.77,  color: COLORS.yellowWhite },
  { id: 'epsilon_tau',name: 'ε Tau',         ra: 4.477,  dec: 19.180,  mag: 3.53,  color: COLORS.white },

  // ===== VIRGO =====
  { id: 'spica',      name: 'Spica',         ra: 13.420, dec: -11.161, mag: 0.97,  color: COLORS.blue },
  { id: 'porrima',    name: 'Porrima',       ra: 12.694, dec: -1.449,  mag: 2.74,  color: COLORS.yellowWhite },
  { id: 'vindemiatrix', name: 'Vindemiatrix', ra: 13.036, dec: 10.959, mag: 2.85,  color: COLORS.yellowWhite },

  // ===== BOOTES =====
  { id: 'arcturus',   name: 'Arcturus',      ra: 14.261, dec: 19.188,  mag: -0.05, color: COLORS.orange },
  { id: 'izar',       name: 'Izar',          ra: 14.750, dec: 27.074,  mag: 2.35,  color: COLORS.orange },
  { id: 'muphrid',    name: 'Muphrid',       ra: 13.911, dec: 18.398,  mag: 2.68,  color: COLORS.yellowWhite },

  // ===== AURIGA =====
  { id: 'capella',    name: 'Capella',       ra: 5.278,  dec: 45.998,  mag: 0.08,  color: COLORS.yellowWhite },
  { id: 'menkalinan', name: 'Menkalinan',    ra: 5.988,  dec: 44.947,  mag: 1.90,  color: COLORS.blueWhite },
  { id: 'mahasim',    name: 'Mahasim',       ra: 5.248,  dec: 41.077,  mag: 2.65,  color: COLORS.white },
  { id: 'hassaleh',   name: 'Hassaleh',      ra: 4.949,  dec: 33.166,  mag: 2.69,  color: COLORS.orange },

  // ===== ERIDANUS =====
  { id: 'achernar',   name: 'Achernar',      ra: 1.628,  dec: -57.237, mag: 0.46,  color: COLORS.blueWhite },
  { id: 'cursa',      name: 'Cursa',         ra: 5.086,  dec: -5.086,  mag: 2.78,  color: COLORS.white },

  // ===== PISCIS AUSTRINUS =====
  { id: 'fomalhaut',  name: 'Fomalhaut',     ra: 22.961, dec: -29.622, mag: 1.16,  color: COLORS.white },

  // ===== DRACO =====
  { id: 'eltanin',    name: 'Eltanin',       ra: 17.507, dec: 51.489,  mag: 2.24,  color: COLORS.orange },
  { id: 'edasich',    name: 'Edasich',       ra: 15.415, dec: 58.966,  mag: 3.29,  color: COLORS.orange },

  // ===== PERSEUS =====
  { id: 'mirfak',     name: 'Mirfak',        ra: 3.405,  dec: 49.861,  mag: 1.79,  color: COLORS.yellowWhite },
  { id: 'algol',      name: 'Algol',         ra: 3.136,  dec: 40.956,  mag: 2.09,  color: COLORS.white },

  // ===== ARIES =====
  { id: 'hamal',      name: 'Hamal',         ra: 2.120,  dec: 23.463,  mag: 2.00,  color: COLORS.orange },
  { id: 'sheratan',   name: 'Sheratan',      ra: 1.892,  dec: 20.808,  mag: 2.64,  color: COLORS.white },

  // ===== CANCER =====
  { id: 'altarf',     name: 'Altarf',        ra: 8.275,  dec: 9.186,   mag: 3.53,  color: COLORS.orange },

  // ===== LIBRA =====
  { id: 'zubenelgenubi', name: 'Zubenelgenubi', ra: 14.848, dec: -16.042, mag: 2.75, color: COLORS.white },
  { id: 'zubeneschamali', name: 'Zubeneschamali', ra: 15.283, dec: -9.383, mag: 2.61, color: COLORS.greenish },

  // ===== CORONA BOREALIS =====
  { id: 'alphacr',    name: 'Alphecca',      ra: 15.578, dec: 26.715,  mag: 2.22,  color: COLORS.white },

  // ===== HERCULES =====
  { id: 'rasalgethi', name: 'Rasalgethi',    ra: 17.245, dec: 14.390,  mag: 2.78,  color: COLORS.red },
  { id: 'kornephoros', name: 'Kornephoros',  ra: 16.503, dec: 21.490,  mag: 2.78,  color: COLORS.yellowWhite },

  // ===== OPHIUCHUS =====
  { id: 'rasalhague', name: 'Rasalhague',    ra: 17.582, dec: 12.560,  mag: 2.08,  color: COLORS.white },
  { id: 'sabik',      name: 'Sabik',         ra: 17.172, dec: -15.725, mag: 2.43,  color: COLORS.white },
  { id: 'cebarin',    name: 'Cebalrai',      ra: 17.725, dec: 4.567,   mag: 2.76,  color: COLORS.orange },

  // ===== DELPHINUS =====
  { id: 'sualocin',   name: 'Sualocin',      ra: 20.714, dec: 15.912,  mag: 3.77,  color: COLORS.blueWhite },
  { id: 'rotanev',    name: 'Rotanev',       ra: 20.626, dec: 14.595,  mag: 3.64,  color: COLORS.yellowWhite },

  // ===== CEPHEUS =====
  { id: 'alderamin',  name: 'Alderamin',     ra: 22.097, dec: 62.586,  mag: 2.45,  color: COLORS.white },

  // ===== TRIANGULUM =====
  { id: 'mothallah',  name: 'Mothallah',     ra: 1.885,  dec: 29.579,  mag: 3.42,  color: COLORS.white },

  // ===== LEPUS =====
  { id: 'arneb',      name: 'Arneb',         ra: 5.546,  dec: -22.437, mag: 2.58,  color: COLORS.yellowWhite },

  // ===== COLUMBA =====
  { id: 'phact',      name: 'Phact',         ra: 5.848,  dec: -34.074, mag: 2.65,  color: COLORS.blueWhite },

  // ===== PUPPIS =====
  { id: 'naos',       name: 'Naos',          ra: 8.126,  dec: -40.003, mag: 2.21,  color: COLORS.blue },

  // ===== VELA =====
  { id: 'regor',      name: 'Regor',         ra: 8.158,  dec: -47.336, mag: 1.75,  color: COLORS.blueWhite },
  { id: 'suhail',     name: 'Suhail',        ra: 9.134,  dec: -43.433, mag: 1.83,  color: COLORS.orange },

  // ===== CORVUS =====
  { id: 'gienah',     name: 'Gienah',        ra: 12.263, dec: -17.542, mag: 2.58,  color: COLORS.blueWhite },

  // ===== CRATER =====
  { id: 'alkes',      name: 'Alkes',         ra: 10.828, dec: -18.299, mag: 3.56,  color: COLORS.orange },

  // ===== HYDRA =====
  { id: 'alphard',    name: 'Alphard',       ra: 9.460,  dec: -8.658,  mag: 1.99,  color: COLORS.orange },

  // ===== LYNX =====
  { id: 'elvashak',   name: 'Elvashak',      ra: 9.010,  dec: 49.213,  mag: 3.14,  color: COLORS.orange },

  // ===== COMA BERENICES =====
  { id: 'diadem',     name: 'Diadem',        ra: 13.198, dec: 17.529,  mag: 4.32,  color: COLORS.white },
];

// Mapa rápido de ID → índice para uso interno
export function buildStarIndex(stars) {
  const map = {};
  stars.forEach((s, i) => { map[s.id] = i; });
  return map;
}

/**
 * Linhas de constelação: pares de IDs de estrelas.
 * Cada par desenha uma linha sutil conectando as duas estrelas.
 */
export const CONSTELLATION_LINES = [
  // --- Crux (Cruzeiro do Sul) ---
  ['acrux', 'mimosa'],
  ['mimosa', 'gacrux'],
  ['gacrux', 'delta_cru'],
  ['delta_cru', 'acrux'],

  // --- Orion ---
  ['betelgeuse', 'bellatrix'],
  ['bellatrix', 'mintaka'],
  ['mintaka', 'alnilam'],
  ['alnilam', 'alnitak'],
  ['alnitak', 'saiph'],
  ['saiph', 'rigel'],
  ['betelgeuse', 'meissa'],
  ['meissa', 'bellatrix'],
  ['alnitak', 'mintaka'],

  // --- Ursa Major ---
  ['dubhe', 'merak'],
  ['merak', 'phecda'],
  ['phecda', 'megrez'],
  ['megrez', 'dubhe'],
  ['megrez', 'alioth'],
  ['alioth', 'mizar'],
  ['mizar', 'alkaid'],

  // --- Cassiopeia ---
  ['caph', 'schedar'],
  ['schedar', 'gamma_cas'],
  ['gamma_cas', 'ruchbah'],
  ['ruchbah', 'epsilon_cas'],

  // --- Scorpius ---
  ['dschubba', 'graffias'],
  ['graffias', 'antares'],
  ['antares', 'dschubba'],
  ['antares', 'sargas'],
  ['sargas', 'shaula'],
  ['shaula', 'kappa_sco'],

  // --- Sagittarius ---
  ['kaus_borealis', 'kaus_media'],
  ['kaus_media', 'kaus_australis'],
  ['ascella', 'nunki'],

  // --- Canis Major ---
  ['sirius', 'mirzam'],
  ['mirzam', 'wezen'],
  ['wezen', 'adhara'],
  ['adhara', 'aludra'],

  // --- Canis Minor ---
  ['procyon', 'gomeisa'],

  // --- Cygnus ---
  ['deneb', 'sadr'],
  ['sadr', 'albireo'],
  ['sadr', 'delta_cyg'],
  ['delta_cyg', 'deneb'],
  ['sadr', 'epsilon_cyg'],
  ['epsilon_cyg', 'zeta_cyg'],

  // --- Aquila ---
  ['altair', 'alshain'],
  ['altair', 'tarazed'],

  // --- Lyra ---
  ['vega', 'sheliak'],
  ['sheliak', 'sulafat'],
  ['sulafat', 'vega'],

  // --- Gemini ---
  ['castor', 'pollux'],
  ['pollux', 'wasat'],
  ['wasat', 'alhena'],
  ['castor', 'mebsuta'],
  ['mebsuta', 'wasat'],

  // --- Leo ---
  ['regulus', 'algieba'],
  ['algieba', 'zosma'],
  ['zosma', 'denebola'],
  ['regulus', 'aldebaran_leo'],

  // --- Andromeda ---
  ['alpheratz', 'mirach'],
  ['mirach', 'almach'],

  // --- Pegasus ---
  ['markab', 'scheat'],
  ['scheat', 'algenib'],
  ['algenib', 'markab'],
  ['enif', 'markab'],

  // --- Taurus (Hyades + Aldebaran) ---
  ['aldebaran', 'theta_tau'],
  ['theta_tau', 'gamma_tau'],
  ['gamma_tau', 'delta_tau'],
  ['delta_tau', 'epsilon_tau'],
  ['epsilon_tau', 'theta_tau'],
  ['aldebaran', 'elnath'],

  // --- Virgo ---
  ['spica', 'porrima'],
  ['porrima', 'vindemiatrix'],

  // --- Bootes ---
  ['arcturus', 'izar'],
  ['arcturus', 'muphrid'],

  // --- Auriga ---
  ['capella', 'menkalinan'],
  ['menkalinan', 'mahasim'],
  ['mahasim', 'hassaleh'],
  ['hassaleh', 'capella'],

  // --- Eridanus ---
  ['achernar', 'cursa'],

  // --- Draco ---
  ['eltanin', 'edasich'],
  ['edasich', 'kochab'],

  // --- Perseus ---
  ['mirfak', 'algol'],

  // --- Aries ---
  ['hamal', 'sheratan'],

  // --- Libra ---
  ['zubenelgenubi', 'zubeneschamali'],

  // --- Corona Borealis ---
  ['alphacr', 'zubenelgenubi'], // estilizado

  // --- Hercules ---
  ['rasalgethi', 'kornephoros'],

  // --- Ophiuchus ---
  ['rasalhague', 'sabik'],
  ['rasalhague', 'cebarin'],

  // --- Delphinus ---
  ['sualocin', 'rotanev'],

  // --- Hydra ---
  ['alphard', 'alkes'],

  // --- Lepus ---
  ['arneb', 'cursa'],

  // --- Vela ---
  ['regor', 'suhail'],

  // --- Crater ---
  ['alkes', 'gienah'],

  // --- Piscis Austrinus ---
  ['fomalhaut', 'formalhaut'], // ponto único, sem linha
];

// Remove linhas inválidas (mesmo ID ou ID inexistente)
export function getValidLines(stars, lines) {
  const idx = buildStarIndex(stars);
  return lines.filter(([a, b]) => a !== b && idx[a] !== undefined && idx[b] !== undefined);
}
