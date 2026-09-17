// Real TSX rendering using the already-installed TypeScript compiler, not source-text assertions.
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./tsx-loader.mjs", import.meta.url);

export const renderComponent = (component, props) => renderToStaticMarkup(createElement(component, props));
