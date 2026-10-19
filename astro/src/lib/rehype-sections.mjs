/**
 * Wraps each <h2> and everything up to the next <h2> in
 *
 *   <section class="copy-section">
 *     <h2>…</h2>
 *     <div class="copy-section-body">…</div>
 *   </section>
 *
 * so the project page can hang the heading in a sticky left rail when there's
 * room (see `.copy-section` in style.css). Anything before the first <h2>
 * stays where it is.
 */
export default function rehypeSections() {
  return (tree) => {
    const children = [];
    let body = null;

    for (const node of tree.children) {
      if (node.type === "element" && node.tagName === "h2") {
        body = element("div", "copy-section-body", []);
        children.push(element("section", "copy-section", [node, body]));
      } else if (body) {
        body.children.push(node);
      } else {
        children.push(node);
      }
    }

    tree.children = children;
  };
}

const element = (tagName, className, children) => ({
  type: "element",
  tagName,
  properties: { className: [className] },
  children,
});
