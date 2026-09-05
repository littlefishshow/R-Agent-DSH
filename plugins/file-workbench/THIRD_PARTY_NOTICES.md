# Source provenance and licenses

The feature implementation is derived from littlefishshow/R-Agent-DSH commit `c5b7365c705f13f993b0ca0a03c566b69761f5b7`, based on deepseek-ai/deepseek-harness commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. Both are distributed under the MIT license reproduced in LICENSE. The private JSONL, persistence coordinator, workspace registry, UI modules and renderer test fixtures retain that license. The standalone build arrangement follows the locally developed workspace-workbench v2 packaging pattern.

The browser bundle includes React Virtual, diff, clsx, KaTeX, Shiki and their Markdown/highlighting dependencies, including the mdast, micromark and unist families. Their MIT or BSD license and notice texts are included per package in [lib/THIRD_PARTY_LICENSES.txt](lib/THIRD_PARTY_LICENSES.txt), generated from the dependencies present in the emitted source maps. KaTeX font data is embedded in the browser CSS. React, Cordis and the shared DSH client runtime remain external and are provided by the DSH host.

Test-only renderer, conversation and locale fixtures come from the unmodified shared DSH baseline above. They compensate for source imports in the published DSH test helper and are excluded from the distributable package.
