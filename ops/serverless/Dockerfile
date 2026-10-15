FROM public.ecr.aws/lambda/nodejs@sha256:6720580baa6f3dbfb25849f4a3579f0e01b0d1ba836a3cdfc06519c8c0bb71c6 AS dependencies
WORKDIR /build
COPY package.json package-lock.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/bundle-parser/package.json packages/bundle-parser/package.json
COPY packages/embedding-sdk/package.json packages/embedding-sdk/package.json
COPY packages/headless-sdk/package.json packages/headless-sdk/package.json
COPY packages/headless-sdk-python/package.json packages/headless-sdk-python/package.json
COPY packages/mcp-server/package.json packages/mcp-server/package.json
COPY packages/o-interpreter/package.json packages/o-interpreter/package.json
COPY packages/parity/package.json packages/parity/package.json
COPY packages/query-engine/package.json packages/query-engine/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci --no-audit --no-fund

FROM dependencies AS browser
# Test-tool acquisition only. This stage and its browser never enter runtime.
ADD --checksum=sha256:b6874fc0d7af15e16a15ef1b73177731f698c296c73d26aa4a90840c0777a338 https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.arm64.tar /browser/pack.tar
COPY ops/serverless/browser/package.json ops/serverless/browser/package-lock.json /browser/tool/
RUN npm ci --prefix /browser/tool --no-audit --no-fund
RUN --network=none node --input-type=module -e "import {createReadStream} from 'node:fs'; import {mkdir} from 'node:fs/promises'; import {createRequire} from 'node:module'; const require=createRequire('/browser/tool/node_modules/@sparticuz/chromium-min/package.json'); const {extract}=require('tar-fs'); await mkdir('/browser/pack'); await new Promise((resolve,reject)=>createReadStream('/browser/pack.tar').pipe(extract('/browser/pack')).on('finish',resolve).on('error',reject))"
ENV AWS_EXECUTION_ENV=AWS_Lambda_nodejs24.x
RUN --network=none node --input-type=module -e "import chromium from '/browser/tool/node_modules/@sparticuz/chromium-min/build/index.js'; await chromium.executablePath('/browser/pack')"
ENV OPENSIGHT_CHROMIUM=/tmp/chromium
ENV FONTCONFIG_PATH=/tmp/fonts
ENV LD_LIBRARY_PATH=/tmp/al2023/lib:/var/lang/lib:/lib64:/usr/lib64:/var/runtime:/var/runtime/lib:/var/task:/var/task/lib:/opt/lib

FROM browser AS test
COPY . .
RUN --network=none npm test
RUN --network=none VITE_OPENSIGHT_SERVERLESS=true npm run build --workspace @opensight/web
RUN --network=none node ops/serverless/package.mjs frontend /frontend
RUN --network=none npm run build:demo --workspace @opensight/web

FROM test AS production
RUN --network=none npm prune --omit=dev --ignore-scripts --offline --no-audit --no-fund
RUN --network=none node ops/serverless/package.mjs runtime /runtime

FROM public.ecr.aws/lambda/nodejs@sha256:6720580baa6f3dbfb25849f4a3579f0e01b0d1ba836a3cdfc06519c8c0bb71c6 AS runtime
WORKDIR /var/task
COPY --from=production /runtime/ ./
# Lambda supplies its unprivileged runtime identity; local acceptance uses --user.
CMD ["packages/api/dist/aws-lambda.handler"]
