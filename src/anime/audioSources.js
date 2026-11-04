// Official uploader metadata and embedded playback verified 2026-10-29.
// Mercury: youtube.com/playlist?list=PLJV1h9xQ7Hx-MSngXeq-sRbelh5zCVRNI
// Sonic X: tmsanime.com/anime-on-tms-official-channel
// Unconfirmed, removed or region-blocked uploads must not be added from catalogue metadata alone.
const DUBS = [
  {
    "animeId": "ap_kidou-senshi-gundam-suisei-no-majo",
    "title": "Mobile Suit Gundam: The Witch from Mercury",
    "publisher": "GUNDAM CHANNEL INTL",
    "episodes": [
      [
        1,
        "cq8zYG_hivI"
      ],
      [
        2,
        "bRqqvwxlPFA"
      ],
      [
        3,
        "hUFpnzhpApo"
      ],
      [
        4,
        "VoL0Vft2n_U"
      ],
      [
        5,
        "G_iLj8Wp7dk"
      ],
      [
        6,
        "m04x09lXhI0"
      ],
      [
        7,
        "GeMjxNk8YL8"
      ],
      [
        8,
        "1tpuVqbnCsQ"
      ],
      [
        9,
        "kThQo5cjVpY"
      ],
      [
        10,
        "-cORn5HzGDY"
      ],
      [
        11,
        "nv2-wgogV6E"
      ],
      [
        12,
        "a6SnMdPzh0s"
      ]
    ]
  },
  {
    "animeId": "ap_kidou-senshi-gundam-suisei-no-majo-part-2",
    "title": "Mobile Suit Gundam: The Witch from Mercury Season 2",
    "publisher": "GUNDAM CHANNEL INTL",
    "episodes": [
      [
        1,
        "b9UVaK2hfkk"
      ],
      [
        2,
        "6fHQhakwYR0"
      ],
      [
        3,
        "Mdh0xJiABPs"
      ],
      [
        4,
        "b3urjpZq1L8"
      ],
      [
        5,
        "17kijQC38zQ"
      ],
      [
        6,
        "3zeYa1pMEXo"
      ],
      [
        7,
        "bg29bSwEmos"
      ],
      [
        8,
        "f6tu0YNXDvg"
      ],
      [
        9,
        "8rAWrbPkuEc"
      ],
      [
        10,
        "fMN-daf4sB8"
      ],
      [
        11,
        "7rIQQmrpZe4"
      ]
    ]
  },
  {
    "animeId": "ap_sonic-x",
    "title": "Sonic X",
    "publisher": "Anime! on TMS Official Channel",
    "episodes": [
      [
        1,
        "9CGih4gMRlk"
      ],
      [
        2,
        "aBgPO32-ka0"
      ],
      [
        3,
        "PzifMBqaEvU"
      ],
      [
        4,
        "BNi7ZoeJOOE"
      ],
      [
        5,
        "qBsRxGQhDKs"
      ],
      [
        6,
        "ZDygQeO9jzo"
      ],
      [
        7,
        "7tB2LgOx8fA"
      ],
      [
        8,
        "9KYeihPwS7Q"
      ],
      [
        9,
        "ZcYxdLTcGvA"
      ],
      [
        10,
        "VwYQ0DnPjWI"
      ],
      [
        11,
        "FTMUZlg7WEg"
      ],
      [
        12,
        "EbmRA75fF6Y"
      ],
      [
        13,
        "WurTQwB-j-U"
      ],
      [
        14,
        "uNqSxwLTjG4"
      ],
      [
        15,
        "w0uuhC6LlFM"
      ],
      [
        16,
        "B_uTFBTNI7o"
      ],
      [
        17,
        "Vc1z6_nBWKA"
      ],
      [
        18,
        "hnUYv2VhcY8"
      ],
      [
        19,
        "cE7WXrzkKrI"
      ],
      [
        20,
        "c8W-VVZtiyk"
      ],
      [
        21,
        "z8QGrmRQsqw"
      ],
      [
        22,
        "nMJG40ht_sw"
      ],
      [
        23,
        "1TAE09a_nwE"
      ],
      [
        24,
        "039J77RlR5M"
      ],
      [
        25,
        "gyUnw0KCDT0"
      ],
      [
        26,
        "Lj6TQAJaj4s"
      ]
    ]
  }
];

export function getDubSelection(animeId, episode, title) {
  const anime = DUBS.find(item => item.animeId === animeId);
  const source = anime?.episodes.find(([number]) => number === episode);
  if (!source) return null;
  const suffix = ` · Episode ${episode} · English dub`;
  const name = typeof title === 'string' && title.trim() ? title.trim() : anime.title;
  const prefix = name.slice(0, 120 - suffix.length).replace(/[\uD800-\uDBFF]$/u, '').trimEnd();
  return { source: 'youtube', id: source[1], title: `${prefix}${suffix}`, position: 0 };
}

export function getDubContext(videoId) {
  for (const anime of DUBS) {
    const source = anime.episodes.find(([, id]) => id === videoId);
    if (source) return { animeId: anime.animeId, episode: source[0], title: anime.title };
  }
  return null;
}

export function getDubEpisodes(animeId) {
  return DUBS.find(item => item.animeId === animeId)?.episodes.map(([number]) => number) || [];
}

export function getDubProvider(animeId) {
  return DUBS.find(item => item.animeId === animeId)?.publisher || '';
}
