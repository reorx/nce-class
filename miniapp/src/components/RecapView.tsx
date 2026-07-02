import { Text, View } from '@tarojs/components';
import type { ParentRecap } from '../lib/api';
import { fmtScore, homeworkTone, medals, recitationTone } from '../lib/recapView';
import './RecapView.scss';

// 个性化课堂回顾（还原 kb/prototypes/08-student-h5.html 右侧屏）：
// 本人卡 / 🏆各组得分（本人组高亮）/ 🌟亮眼 / ⚠️被提醒。
export default function RecapView({
  recap,
  childName,
  className,
}: {
  recap: ParentRecap;
  childName: string;
  className: string;
}) {
  const medalList = medals(recap.groups.map((g) => g.score));
  const lesson = recap.lessonNumber ? `第${recap.lessonNumber}课` : '';
  const title = recap.lessonTitle ? `《${recap.lessonTitle}》` : '';
  const sub = [`${lesson}${title}`, recap.date].filter(Boolean).join(' · ');

  return (
    <View className="recap">
      <View className="rhead">
        <View className="t">{className} · 课堂回顾</View>
        <View className="s">{sub}</View>
      </View>

      {recap.mine ? (
        <View className="mine">
          <View className="nm">⭐ {childName}今天的表现</View>
          <View className="row">
            {recap.mine.attended ? (
              <>
                {recap.mine.groupName && (
                  <Text className="tag t-grp">
                    {recap.mine.groupEmoji ?? ''} {recap.mine.groupName}
                  </Text>
                )}
                <Text className="tag t-star">个人 {fmtScore(recap.mine.personalScore)}</Text>
                <Text className={`tag tone-${homeworkTone(recap.mine.homework)}`}>作业 {recap.mine.homework}</Text>
                <Text className={`tag tone-${recitationTone(recap.mine.recitation)}`}>
                  背书 {recap.mine.recitation}
                </Text>
              </>
            ) : (
              <Text className="tag tone-muted">本堂课缺席</Text>
            )}
          </View>
        </View>
      ) : (
        <View className="mine">
          <View className="nm">⭐ {childName}</View>
          <View className="row">
            <Text className="tag tone-muted">未参加本堂课</Text>
          </View>
        </View>
      )}

      <View className="sec">
        <View className="h">🏆 各组得分</View>
        {recap.groups.map((g, i) => (
          <View key={g.id} className={`rank${g.mine ? ' me' : ''}`}>
            <Text className="medal">{medalList[i] || '　'}</Text>
            <Text className="gname">
              {g.emoji ?? ''} {g.name}
              {g.mine ? '（你的组）' : ''}
            </Text>
            <Text className="sc">{g.score}</Text>
          </View>
        ))}
      </View>

      {recap.stars.length > 0 && (
        <View className="sec">
          <View className="h">🌟 今天表现亮眼</View>
          <View className="names">
            {recap.stars.map((s) => (
              <Text key={s.name} className="b good">
                {s.name}
              </Text>
            ))}
          </View>
        </View>
      )}

      {recap.warned.length > 0 && (
        <View className="sec">
          <View className="h">⚠️ 今天被老师提醒</View>
          <View className="names">
            {recap.warned.map((s) => (
              <Text key={s.name} className="b warn">
                {s.name}
              </Text>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
