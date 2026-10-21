/**
 * Връзка от добавка в плана към каталога на BIOCODE (biocode-bg.com).
 *
 * Каталогът търси по текст (portfolio.html?q=…): пълното име от плана
 * („Омега-3 от водорасли (DHA/EPA)“) често не намира нищо, затова името се
 * свежда до думата, по която магазинът има продукти. Непознато име → първите
 * две думи без скоби и дозировка.
 */
(function () {
    var SHOP = 'https://biocode-bg.com/portfolio.html';
    // По-конкретното е отгоре: „D3 + K2“ преди „D3“, „от водорасли“ преди „омега-3“.
    var TERMS = [
        [/водорасл|algae/i, 'algae'],
        [/омега|omega|рибено масло|fish oil/i, 'Омега-3'],
        [/d3\s*\+\s*k2|d3\/k2/i, 'Витамин D3 + K2'],
        [/витамин\s*d|vitamin\s*d/i, 'Витамин D3'],
        [/b12|кобаламин|cobalamin/i, 'Витамин B12'],
        [/b[\s-]*комплекс|b[\s-]*complex/i, 'b-complex'],
        [/магнези|magnes/i, 'магнезий'],
        [/креатин|creatine/i, 'Креатин монохидрат'],
        [/инозитол|inositol/i, 'инозитол'],
        [/берберин|berberine/i, 'берберин'],
        [/хром|chromium/i, 'хром'],
        [/желязо|iron/i, 'Желязо'],
        [/калций|calcium/i, 'калций'],
        [/цинк|zinc/i, 'Цинк'],
        [/селен|selenium/i, 'селен'],
        [/псилиум|живовляк|psyllium/i, 'psyllium'],
        [/пробиот|probiotic|lactobac|bifido/i, 'probiotic'],
        [/куркум|curcum/i, 'curcumin'],
        [/ашваганд|ashwagand/i, 'ashwagandha'],
        [/теанин|theanine/i, 'theanine'],
        [/q10|коензим|coenzyme/i, 'Q10'],
        [/глутамин|glutamine/i, 'глутамин'],
        [/колаген|collagen/i, 'колаген'],
        [/фолиев|фолат|folate|folic/i, 'фолиева'],
        [/мелатонин|melatonin/i, 'мелатонин'],
        [/електролит|electrolyte/i, 'електролити'],
        [/алфа-липоева|lipoic/i, 'alpha lipoic'],
        [/витамин\s*c|vitamin\s*c/i, 'Витамин C'],
        [/протеин|protein/i, 'протеин']
    ];

    function query(name) {
        var text = String(name || '');
        for (var i = 0; i < TERMS.length; i++) {
            if (TERMS[i][0].test(text)) return TERMS[i][1];
        }
        return text.replace(/\([^)]*\)/g, ' ').replace(/[\d.,]+\s*(mg|mcg|µg|iu|ie|g|мг|мкг)\b/gi, ' ')
            .split(/\s+/).filter(Boolean).slice(0, 2).join(' ').slice(0, 60);
    }

    function url(name) {
        return SHOP + '?q=' + encodeURIComponent(query(name)) + '&utm_source=nutriplan&utm_medium=supplement';
    }

    window.NutriPlanSupplementShop = { query: query, url: url };
})();
