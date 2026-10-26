import type {AnswerSection} from './types.ts';

export function TestAssociationNotice({section}:{section:AnswerSection}) {
  return section.testAssets && !section.relations?.length
    ? <p>本视图尚未建立测试与规则关联；不据此推断系统没有测试。</p>
    : null;
}
