/**
 * i18n minimal pour les pages servies par le Worker (retour Stripe).
 *
 * Indépendant du système i18n de l'extension : ces pages sont rendues par
 * le serveur. La langue vient du navigateur du donateur via l'en-tête
 * `Accept-Language`, avec repli sur l'anglais.
 */

export type Locale =
  | 'en' | 'fr' | 'it' | 'es' | 'de' | 'pt' | 'ru'
  | 'ja' | 'ko' | 'zh' | 'tr' | 'pl' | 'nl' | 'fi' | 'hi';

export interface PageStrings {
  successTitle: string;
  successHeading: string;
  successBody: string;
  cancelTitle: string;
  cancelHeading: string;
  cancelBody: string;
  /** Pages ouvertes depuis le web (lien GitHub), pas depuis l'extension. */
  back: string;
  webSuccessBody: string;
  webCancelBody: string;
}

const STRINGS: Record<Locale, PageStrings> = {
  en: {
    successTitle: 'Thank you — Vespry',
    successHeading: 'Thank you!',
    successBody: 'Your support joins the Vespry wall. This window closes itself…',
    cancelTitle: 'Donation cancelled — Vespry',
    cancelHeading: 'Donation cancelled',
    cancelBody: 'No worries, nothing was charged. You can close this window.',
    back: 'Back to Vespry',
    webSuccessBody: 'Your support joins the Vespry wall. Thank you for keeping it free.',
    webCancelBody: 'No worries, nothing was charged.',
  },
  fr: {
    successTitle: 'Merci — Vespry',
    successHeading: 'Merci !',
    successBody: 'Ton soutien rejoint le mur de Vespry. Cette fenêtre se ferme toute seule…',
    cancelTitle: 'Don annulé — Vespry',
    cancelHeading: 'Don annulé',
    cancelBody: "Aucun souci, rien n'a été débité. Tu peux fermer cette fenêtre.",
    back: 'Retour à Vespry',
    webSuccessBody: 'Ton soutien rejoint le mur de Vespry. Merci de le garder gratuit.',
    webCancelBody: 'Aucun souci, rien n\'a été débité.',
  },
  it: {
    successTitle: 'Grazie — Vespry',
    successHeading: 'Grazie!',
    successBody: 'Il tuo sostegno si unisce al muro di Vespry. Questa finestra si chiude da sola…',
    cancelTitle: 'Donazione annullata — Vespry',
    cancelHeading: 'Donazione annullata',
    cancelBody: "Nessun problema, non è stato addebitato nulla. Puoi chiudere questa finestra.",
    back: 'Torna a Vespry',
    webSuccessBody: 'Il tuo sostegno si unisce al muro di Vespry. Grazie per mantenerlo gratuito.',
    webCancelBody: 'Nessun problema, non è stato addebitato nulla.',
  },
  es: {
    successTitle: 'Gracias — Vespry',
    successHeading: '¡Gracias!',
    successBody: 'Tu apoyo se une al muro de Vespry. Esta ventana se cerrará sola…',
    cancelTitle: 'Donación cancelada — Vespry',
    cancelHeading: 'Donación cancelada',
    cancelBody: 'No te preocupes, no se cobró nada. Puedes cerrar esta ventana.',
    back: 'Volver a Vespry',
    webSuccessBody: 'Tu apoyo se une al muro de Vespry. Gracias por mantenerlo gratuito.',
    webCancelBody: 'No te preocupes, no se cobró nada.',
  },
  de: {
    successTitle: 'Danke — Vespry',
    successHeading: 'Danke!',
    successBody: 'Deine Unterstützung kommt auf die Vespry-Wand. Dieses Fenster schließt sich von selbst…',
    cancelTitle: 'Spende abgebrochen — Vespry',
    cancelHeading: 'Spende abgebrochen',
    cancelBody: 'Keine Sorge, es wurde nichts abgebucht. Du kannst dieses Fenster schließen.',
    back: 'Zurück zu Vespry',
    webSuccessBody: 'Deine Unterstützung kommt auf die Vespry-Wand. Danke, dass du Vespry kostenlos hältst.',
    webCancelBody: 'Keine Sorge, es wurde nichts abgebucht.',
  },
  pt: {
    successTitle: 'Obrigado — Vespry',
    successHeading: 'Obrigado!',
    successBody: 'Seu apoio entra no mural do Vespry. Esta janela se fecha sozinha…',
    cancelTitle: 'Doação cancelada — Vespry',
    cancelHeading: 'Doação cancelada',
    cancelBody: 'Tudo bem, nada foi cobrado. Você pode fechar esta janela.',
    back: 'Voltar ao Vespry',
    webSuccessBody: 'Seu apoio entra no mural do Vespry. Obrigado por mantê-lo gratuito.',
    webCancelBody: 'Sem problemas, nada foi cobrado.',
  },
  ru: {
    successTitle: 'Спасибо — Vespry',
    successHeading: 'Спасибо!',
    successBody: 'Ваша поддержка попадает на стену Vespry. Это окно закроется само…',
    cancelTitle: 'Платёж отменён — Vespry',
    cancelHeading: 'Платёж отменён',
    cancelBody: 'Ничего страшного, ничего не списано. Можете закрыть это окно.',
    back: 'Вернуться к Vespry',
    webSuccessBody: 'Ваша поддержка появится на стене Vespry. Спасибо, что помогаете ему оставаться бесплатным.',
    webCancelBody: 'Не волнуйтесь, деньги не списаны.',
  },
  ja: {
    successTitle: 'ありがとうございました — Vespry',
    successHeading: 'ありがとうございました!',
    successBody: 'あなたの支援が Vespry の壁に加わりました。このウィンドウは自動的に閉じます…',
    cancelTitle: '寄付がキャンセルされました — Vespry',
    cancelHeading: '寄付がキャンセルされました',
    cancelBody: 'ご心配なく、課金はされていません。このウィンドウを閉じて構いません。',
    back: 'Vespry に戻る',
    webSuccessBody: 'あなたの支援が Vespry の壁に加わります。無料で続けられるのはあなたのおかげです。',
    webCancelBody: 'ご安心ください。請求は発生していません。',
  },
  ko: {
    successTitle: '감사합니다 — Vespry',
    successHeading: '감사합니다!',
    successBody: '당신의 후원이 Vespry의 벽에 함께합니다. 이 창은 잠시 후 자동으로 닫힙니다…',
    cancelTitle: '기부 취소됨 — Vespry',
    cancelHeading: '기부 취소됨',
    cancelBody: '걱정 마세요, 청구된 금액이 없습니다. 이 창을 닫으셔도 됩니다.',
    back: 'Vespry로 돌아가기',
    webSuccessBody: '후원이 Vespry 후원 벽에 올라갑니다. 무료로 유지할 수 있게 해 주셔서 감사합니다.',
    webCancelBody: '걱정 마세요. 결제되지 않았습니다.',
  },
  zh: {
    successTitle: '感谢 — Vespry',
    successHeading: '感谢!',
    successBody: '你的支持已加入 Vespry 之墙。此窗口将自动关闭…',
    cancelTitle: '已取消捐赠 — Vespry',
    cancelHeading: '已取消捐赠',
    cancelBody: '别担心,未收取任何费用。你可以关闭此窗口。',
    back: '返回 Vespry',
    webSuccessBody: '你的支持已加入 Vespry 支持墙。感谢你让它保持免费。',
    webCancelBody: '别担心，没有扣款。',
  },
  tr: {
    successTitle: 'Teşekkürler — Vespry',
    successHeading: 'Teşekkürler!',
    successBody: 'Desteğin Vespry duvarına katılıyor. Bu pencere kendiliğinden kapanacak…',
    cancelTitle: 'Bağış iptal edildi — Vespry',
    cancelHeading: 'Bağış iptal edildi',
    cancelBody: 'Endişelenme, hiçbir ücret tahsil edilmedi. Bu pencereyi kapatabilirsin.',
    back: 'Vespry\'ye dön',
    webSuccessBody: 'Desteğin Vespry duvarına ekleniyor. Ücretsiz kalmasına yardım ettiğin için teşekkürler.',
    webCancelBody: 'Merak etme, hiçbir ücret alınmadı.',
  },
  pl: {
    successTitle: 'Dziękuję — Vespry',
    successHeading: 'Dziękuję!',
    successBody: 'Twoje wsparcie dołącza do ściany Vespry. To okno zamknie się samo…',
    cancelTitle: 'Darowizna anulowana — Vespry',
    cancelHeading: 'Darowizna anulowana',
    cancelBody: 'Spokojnie, nic nie zostało pobrane. Możesz zamknąć to okno.',
    back: 'Wróć do Vespry',
    webSuccessBody: 'Twoje wsparcie trafia na ścianę Vespry. Dziękujemy, że pomagasz utrzymać go za darmo.',
    webCancelBody: 'Spokojnie, nic nie zostało pobrane.',
  },
  nl: {
    successTitle: 'Bedankt — Vespry',
    successHeading: 'Bedankt!',
    successBody: 'Je steun verschijnt op de Vespry-muur. Dit venster sluit zichzelf…',
    cancelTitle: 'Donatie geannuleerd — Vespry',
    cancelHeading: 'Donatie geannuleerd',
    cancelBody: 'Geen zorgen, er is niets afgeschreven. Je kunt dit venster sluiten.',
    back: 'Terug naar Vespry',
    webSuccessBody: 'Je steun komt op de muur van Vespry. Bedankt dat je het gratis houdt.',
    webCancelBody: 'Geen zorgen, er is niets afgeschreven.',
  },
  fi: {
    successTitle: 'Kiitos — Vespry',
    successHeading: 'Kiitos!',
    successBody: 'Tukesi liittyy Vespryn seinälle. Tämä ikkuna sulkeutuu itsestään…',
    cancelTitle: 'Lahjoitus peruttu — Vespry',
    cancelHeading: 'Lahjoitus peruttu',
    cancelBody: 'Ei hätää, mitään ei veloitettu. Voit sulkea tämän ikkunan.',
    back: 'Takaisin Vespryyn',
    webSuccessBody: 'Tukesi liittyy Vespryn seinälle. Kiitos, että pidät sen ilmaisena.',
    webCancelBody: 'Ei hätää, mitään ei veloitettu.',
  },
  hi: {
    successTitle: 'धन्यवाद — Vespry',
    successHeading: 'धन्यवाद!',
    successBody: 'आपका समर्थन Vespry की दीवार पर जुड़ रहा है। यह विंडो स्वयं बंद हो जाएगी…',
    cancelTitle: 'दान रद्द — Vespry',
    cancelHeading: 'दान रद्द',
    cancelBody: 'चिंता न करें, कोई शुल्क नहीं लिया गया। आप इस विंडो को बंद कर सकते हैं।',
    back: 'Vespry पर वापस जाएँ',
    webSuccessBody: 'आपका समर्थन Vespry की दीवार पर जुड़ गया है। इसे मुफ़्त बनाए रखने के लिए धन्यवाद।',
    webCancelBody: 'चिंता न करें, कोई शुल्क नहीं लिया गया।',
  },
};

/**
 * Choisit la meilleure locale supportée à partir de l'en-tête
 * `Accept-Language` (RFC 7231). Repli sur `en` si aucune correspondance.
 *
 * L'en-tête est par exemple `fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7`. On garde
 * les codes triés par poids et on prend le premier dont le préfixe à deux
 * lettres figure dans `STRINGS`.
 */
export function pickLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return 'en';
  const entries = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qPart = params.find((p) => p.trim().startsWith('q='));
      const q = qPart ? Number(qPart.split('=')[1]) : 1;
      return { tag: (tag ?? '').toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((e) => e.tag && e.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of entries) {
    const code = tag.slice(0, 2);
    if (code in STRINGS) return code as Locale;
  }
  return 'en';
}

export function strings(locale: Locale): PageStrings {
  return STRINGS[locale];
}
