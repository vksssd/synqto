// ─── WhatsApp-style Group Info Modal (View & Edit Group Details, Online Members) ───

import React, { useState } from 'react';
import { StudyGroup, GroupSchedule } from './group.types';
import { GroupService } from './group.service';
import {
  X, Edit3, Save, Users, Clock, Target, BookOpen,
  Hash, Shield, Crown, User, Plus, Trash2,
} from 'lucide-react';

interface GroupInfoModalProps {
  group: StudyGroup | null;
  isOpen: boolean;
  onClose: () => void;
  onLeaveGroup?: (groupId: string) => void;
  onlineMembers: Array<{ peerId: string; nickname: string; avatar: string; color?: string }>;
  myPeerId: string;
  isAdmin: boolean;
}

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const GroupInfoModal: React.FC<GroupInfoModalProps> = ({
  group,
  isOpen,
  onClose,
  onLeaveGroup,
  onlineMembers,
  myPeerId,
  isAdmin,
}) => {
  const groupService = GroupService.getInstance();

  const [isEditing, setIsEditing] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  const [editGoals, setEditGoals] = useState('');
  const [editRules, setEditRules] = useState('');
  const [editOpenTime, setEditOpenTime] = useState('');
  const [editCloseTime, setEditCloseTime] = useState('');
  const [editTimezone, setEditTimezone] = useState('IST');
  const [editDays, setEditDays] = useState<string[]>([]);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen || !group) return null;

  const startEditing = () => {
    setEditDesc(group.description || '');
    setEditGoals(group.goals || '');
    setEditRules(group.rules || '');
    setEditOpenTime(group.schedule?.openTime || '');
    setEditCloseTime(group.schedule?.closeTime || '');
    setEditTimezone(group.schedule?.timezone || 'IST');
    setEditDays(group.schedule?.days || []);
    setEditTags([...(group.tags || ['#general'])]);
    setIsEditing(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    const schedule: GroupSchedule | undefined =
      editOpenTime || editCloseTime
        ? { openTime: editOpenTime, closeTime: editCloseTime, timezone: editTimezone, days: editDays }
        : undefined;

    await groupService.updateGroupInfo(group.id, {
      description: editDesc,
      goals: editGoals,
      rules: editRules,
      schedule,
      tags: editTags,
    });
    setIsEditing(false);
    setIsSaving(false);
  };

  const toggleDay = (day: string) => {
    setEditDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const addTag = () => {
    let tag = newTagInput.trim();
    if (!tag) return;
    if (!tag.startsWith('#')) tag = `#${tag}`;
    tag = tag.toLowerCase().replace(/[^a-z0-9#-]/g, '');
    if (tag.length > 1 && !editTags.includes(tag)) {
      setEditTags([...editTags, tag]);
    }
    setNewTagInput('');
  };

  const removeTag = (tag: string) => {
    if (tag === '#general') return; // can't remove #general
    setEditTags(editTags.filter((t) => t !== tag));
  };

  const sectionStyle: React.CSSProperties = {
    padding: '10px 12px',
    borderRadius: '8px',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid var(--border-subtle)',
  };

  const sectionHeaderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    marginBottom: '6px',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '380px', maxHeight: '85vh', overflowY: 'auto' }}
      >
        {/* ─── Header ─── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(139, 92, 246, 0.2))',
                border: '1px solid var(--border-medium)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px',
              }}
            >
              {group.avatar}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '15px', color: '#f8fafc' }}>{group.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
                <Users size={11} />
                <span>{onlineMembers.length} online</span>
                <span style={{ color: '#10b981' }}>●</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {isAdmin && !isEditing && (
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={startEditing}
                title="Edit Group Info"
              >
                <Edit3 size={14} color="var(--primary)" />
              </button>
            )}
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* ─── Description ─── */}
          <div style={sectionStyle}>
            <div style={sectionHeaderStyle}>
              <BookOpen size={12} color="var(--primary)" />
              <span>Description</span>
            </div>
            {isEditing ? (
              <textarea
                className="input-glass"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={2}
                placeholder="What is this group about?"
                style={{ fontSize: '11px', resize: 'vertical' }}
              />
            ) : (
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                {group.description || 'No description set.'}
              </p>
            )}
          </div>

          {/* ─── Goals ─── */}
          <div style={sectionStyle}>
            <div style={sectionHeaderStyle}>
              <Target size={12} color="#f59e0b" />
              <span>Goals</span>
            </div>
            {isEditing ? (
              <textarea
                className="input-glass"
                value={editGoals}
                onChange={(e) => setEditGoals(e.target.value)}
                rows={2}
                placeholder="What are the group goals?"
                style={{ fontSize: '11px', resize: 'vertical' }}
              />
            ) : (
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                {group.goals || 'No goals set yet.'}
              </p>
            )}
          </div>

          {/* ─── Rules ─── */}
          <div style={sectionStyle}>
            <div style={sectionHeaderStyle}>
              <Shield size={12} color="#f43f5e" />
              <span>Rules</span>
            </div>
            {isEditing ? (
              <textarea
                className="input-glass"
                value={editRules}
                onChange={(e) => setEditRules(e.target.value)}
                rows={3}
                placeholder="Group rules (one per line)"
                style={{ fontSize: '11px', resize: 'vertical', fontFamily: 'inherit' }}
              />
            ) : (
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {group.rules ? (
                  group.rules.split('\n').map((rule, i) => (
                    <div key={i} style={{ display: 'flex', gap: '4px' }}>
                      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{rule.match(/^\d/) ? '' : `${i + 1}.`}</span>
                      <span>{rule}</span>
                    </div>
                  ))
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>No rules set yet.</span>
                )}
              </div>
            )}
          </div>

          {/* ─── Schedule ─── */}
          <div style={sectionStyle}>
            <div style={sectionHeaderStyle}>
              <Clock size={12} color="#06b6d4" />
              <span>Schedule</span>
            </div>
            {isEditing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="time"
                    className="input-glass"
                    value={editOpenTime}
                    onChange={(e) => setEditOpenTime(e.target.value)}
                    style={{ fontSize: '11px', flex: 1 }}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>to</span>
                  <input
                    type="time"
                    className="input-glass"
                    value={editCloseTime}
                    onChange={(e) => setEditCloseTime(e.target.value)}
                    style={{ fontSize: '11px', flex: 1 }}
                  />
                  <select
                    value={editTimezone}
                    onChange={(e) => setEditTimezone(e.target.value)}
                    style={{
                      background: 'var(--bg-glass-input)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '4px',
                      padding: '4px',
                      fontSize: '10px',
                    }}
                  >
                    <option value="IST">IST</option>
                    <option value="EST">EST</option>
                    <option value="PST">PST</option>
                    <option value="UTC">UTC</option>
                    <option value="CET">CET</option>
                    <option value="JST">JST</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {DAYS_OF_WEEK.map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      style={{
                        fontSize: '10px',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        border: editDays.includes(day)
                          ? '1px solid var(--primary)'
                          : '1px solid var(--border-subtle)',
                        background: editDays.includes(day)
                          ? 'rgba(99, 102, 241, 0.2)'
                          : 'rgba(255,255,255,0.03)',
                        color: editDays.includes(day) ? '#c7d2fe' : 'var(--text-muted)',
                        cursor: 'pointer',
                        fontWeight: editDays.includes(day) ? 700 : 400,
                      }}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                {group.schedule?.openTime ? (
                  <>
                    <span style={{ fontWeight: 600 }}>
                      🕖 {group.schedule.openTime}
                      {group.schedule.closeTime ? ` – ${group.schedule.closeTime}` : ''}
                      {group.schedule.timezone ? ` ${group.schedule.timezone}` : ''}
                    </span>
                    {group.schedule.days && group.schedule.days.length > 0 && (
                      <div style={{ marginTop: '3px', color: 'var(--text-muted)' }}>
                        Days: {group.schedule.days.join(', ')}
                      </div>
                    )}
                  </>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>No schedule set.</span>
                )}
              </div>
            )}
          </div>

          {/* ─── #Tag Sub-Channels ─── */}
          <div style={sectionStyle}>
            <div style={sectionHeaderStyle}>
              <Hash size={12} color="#8b5cf6" />
              <span>Channels</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {(isEditing ? editTags : group.tags || ['#general']).map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: '10px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'rgba(99, 102, 241, 0.12)',
                    border: '1px solid rgba(99, 102, 241, 0.25)',
                    color: '#a5b4fc',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  {tag}
                  {isEditing && tag !== '#general' && (
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#f87171',
                        cursor: 'pointer',
                        padding: 0,
                        display: 'flex',
                      }}
                    >
                      <X size={10} />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {isEditing && (
              <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                <input
                  type="text"
                  className="input-glass"
                  placeholder="Add #tag..."
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
                  }}
                  style={{ flex: 1, fontSize: '10px' }}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={addTag}
                  style={{ fontSize: '10px', padding: '3px 8px' }}
                >
                  <Plus size={11} />
                </button>
              </div>
            )}
          </div>

          {/* ─── Save / Cancel (Edit Mode) ─── */}
          {isEditing && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setIsEditing(false)}
                style={{ flex: 1, fontSize: '11px' }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSave}
                disabled={isSaving}
                style={{ flex: 2, fontSize: '11px', gap: '4px' }}
              >
                <Save size={12} />
                <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          )}

          {/* ─── Online Members ─── */}
          <div style={sectionStyle}>
            <div style={sectionHeaderStyle}>
              <Users size={12} color="#10b981" />
              <span>Online Members ({onlineMembers.length})</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '140px', overflowY: 'auto' }}>
              {onlineMembers.length === 0 ? (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', padding: '8px' }}>
                  No members online right now
                </div>
              ) : (
                onlineMembers.map((member) => {
                  const isMe = member.peerId === myPeerId;
                  const isCreator = member.peerId === group.creatorPeerId;
                  const isAdminMember = group.adminPeerIds?.includes(member.peerId);

                  return (
                    <div
                      key={member.peerId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '4px 6px',
                        borderRadius: '6px',
                        background: isMe ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                      }}
                    >
                      <span style={{ fontSize: '16px' }}>{member.avatar}</span>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: member.color || '#f8fafc', flex: 1 }}>
                        {member.nickname}
                      </span>
                      {isMe && (
                        <span style={{
                          fontSize: '9px', fontWeight: 700, color: '#10b981',
                          background: 'rgba(16,185,129,0.15)', padding: '1px 5px', borderRadius: '3px',
                        }}>
                          You
                        </span>
                      )}
                      {isCreator && <Crown size={12} color="#fbbf24" title="Creator" />}
                      {isAdminMember && !isCreator && <Shield size={11} color="#8b5cf6" title="Admin" />}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ─── Leave Group Button ─── */}
          {!group.isCreator && (group.isMember || group.isCreator) && onLeaveGroup && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                onLeaveGroup(group.id);
                onClose();
              }}
              style={{
                color: '#f87171',
                fontSize: '11px',
                gap: '4px',
                border: '1px solid rgba(244, 63, 94, 0.2)',
                justifyContent: 'center',
              }}
            >
              <Trash2 size={12} />
              <span>Leave Group</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
