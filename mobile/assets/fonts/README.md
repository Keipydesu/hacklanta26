# UI fonts

Barlow Condensed, Overpass and Overpass Mono, the faces used in the Bypass demo film
([decision 026](../../../docs/decisions/026-bypass-film-theme.md)). All three are licensed under the
SIL Open Font License 1.1, which permits bundling and redistribution with the licence text; the
licences are alongside as `OFL-*.txt`. None declares a Reserved Font Name.

Source: [google/fonts](https://github.com/google/fonts) at commit
`bd8f81ddb5c74d5c8897b36ad88b440266245103`, retrieved 2026-10-10.

| File | Origin | SHA-256 |
| --- | --- | --- |
| `BarlowCondensed-Bold.ttf` | `ofl/barlowcondensed`, unmodified | `e476562ec9c1e16cf16475895b511f08c804f438cc9a9f80a44ea50a0eeb5b65` |
| `BarlowCondensed-ExtraBold.ttf` | `ofl/barlowcondensed`, unmodified | `724c9c25952d5f4a2d87185d9767aa006144c5f0d944dc05bf7d5d603551c260` |
| `Overpass-Regular.ttf` | static instance, `wght=400`, of `ofl/overpass/Overpass[wght].ttf` | `f5208e52e43729198033c1bda0f379fdf241fa56da2e42859f11aa96ec966d72` |
| `Overpass-SemiBold.ttf` | static instance, `wght=600`, of the same file | `1893c1b8dac663e6d11ea247b7568d477a635dfca7d01b901a681e7ce5a42fb1` |
| `OverpassMono-SemiBold.ttf` | static instance, `wght=600`, of `ofl/overpassmono/OverpassMono[wght].ttf` | `b11934d3a5bec3050ad4a06d886b9d6fe80d34580c979d963cb2b438a364c5d9` |

The upstream Overpass files are variable fonts (SHA-256 `970717df…d21f0073` and `49f230e1…bce1ae4f`).
React Native selects a face by file, so fixed weights were cut with fontTools 4.65:

```python
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
instantiateVariableFont(TTFont("Overpass[wght].ttf"), {"wght": 600}, updateFontNames=True).save("Overpass-SemiBold.ttf")
```

`src/ui/theme.ts` loads each file under its own family name. Do not synthesize bold or italic on
top of them. System text is used until the fonts have loaded.
