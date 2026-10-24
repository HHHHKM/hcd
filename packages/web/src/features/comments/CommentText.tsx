export default function CommentText({ text }: { text: string }) {
  const result = [];
  const pattern = /@\[([^\]\n]{1,100})\]\((u_[a-zA-Z0-9]+|ai)\)/g;
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    result.push(text.slice(position, match.index));
    result.push(
      <span className="comment-mention" key={match.index}>
        @{match[1]}
      </span>,
    );
    position = match.index! + match[0].length;
  }
  result.push(text.slice(position));
  return <>{result}</>;
}
