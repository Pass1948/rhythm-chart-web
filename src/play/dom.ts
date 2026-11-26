// 아주 작은 화면 그리기 도구: 요소를 만들고 속성·자식을 붙인다. (플레이 화면 전용)

type Child = Node | string | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string;
  html?: string;
  attrs?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
}

/** 요소 하나를 만든다. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: ElProps = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class !== undefined) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.attrs !== undefined) {
    for (const [key, value] of Object.entries(props.attrs)) node.setAttribute(key, value);
  }
  if (props.style !== undefined) Object.assign(node.style, props.style);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}
