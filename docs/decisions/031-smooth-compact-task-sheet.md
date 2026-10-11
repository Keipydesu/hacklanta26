# 031. Smooth sheet motion and compact reporting

- Status: Accepted
- Date: 2026-10-10
- Supersedes: Decisions 027 and 029's Done buttons; decision 030's layout-driven spring implementation.

The operator reported choppy expansion/collapse, excessive report height and a redundant Done
button. Slide a fixed sheet surface with a native-driven transform. Do not animate layout height:
that resized the MapLibre WebView and triggered React layout updates on every frame. Resize the
map before collapsing or after expansion settles; retain attribution above the resting panel.

Report height follows measured content, capped at the existing expanded limit. Keep the category
picker close to its heading and grow for Submit, location errors and queued reports; overflow
scrolls. Remove Done from all sheet headings. Drag down, map tap and accessible Collapse panel
still close reporting without discarding its draft. Search retains its existing Cancel action,
place selection and map-choice exits. Trip endpoint and report submission rules are unchanged.

No dependencies or API changes. TypeScript and 15 sheet/report-flow/trip tests pass. iPhone 17 Pro
simulator inspection confirms compact reporting, growth for Submit and accessible collapse. A
physical-device check of fast repeated drags and frame pacing remains outstanding.
