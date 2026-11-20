import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { CATEGORIES, CURRENCY, MENU_IMAGES_BUCKET } from '../lib/config'
import type { Category, MenuItem } from '../lib/types'
import { FoodImage } from './FoodImage'
import { CloseIcon } from './Icons'

interface Props {
  item: MenuItem | null // null = create new
  onClose: () => void
  onSaved: (item: MenuItem) => void
}

const MAX_BYTES = 5 * 1024 * 1024

export function MenuItemForm({ item, onClose, onSaved }: Props) {
  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [price, setPrice] = useState(item ? String(item.price) : '')
  const [category, setCategory] = useState<Category>(item?.category ?? 'Mains')
  const [available, setAvailable] = useState(item?.available ?? true)
  const [bestSeller, setBestSeller] = useState(Boolean(item?.best_seller))
  const [imageUrl, setImageUrl] = useState<string | null>(item?.image_url ?? null)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const onPickFile = (f: File | undefined) => {
    setError(null)
    if (!f) return
    if (!f.type.startsWith('image/')) return setError('Please choose an image file.')
    if (f.size > MAX_BYTES) return setError('Image must be smaller than 5 MB.')
    setFile(f)
  }

  async function uploadImage(f: File): Promise<string> {
    const ext = f.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `items/${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from(MENU_IMAGES_BUCKET)
      .upload(path, f, { cacheControl: '31536000', contentType: f.type, upsert: false })
    if (upErr) throw new Error(`Image upload failed: ${upErr.message}`)
    return supabase.storage.from(MENU_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const priceNum = Number(price)
    if (!name.trim()) return setError('Name is required.')
    if (!Number.isFinite(priceNum) || priceNum < 0) return setError('Enter a valid price.')

    setSaving(true)
    try {
      const finalUrl = file ? await uploadImage(file) : imageUrl
      const payload = {
        name: name.trim(),
        description: description.trim(),
        price: priceNum,
        category,
        available,
        best_seller: bestSeller,
        image_url: finalUrl,
      }

      const query = item
        ? supabase.from('menu_items').update(payload).eq('id', item.id).select().single()
        : supabase.from('menu_items').insert(payload).select().single()

      const { data, error: dbErr } = await query
      if (dbErr) throw new Error(dbErr.message)
      onSaved({ ...(data as MenuItem), price: Number(data.price), best_seller: Boolean(data.best_seller) })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={item ? 'Edit item' : 'Add item'} onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{item ? 'Edit menu item' : 'Add menu item'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <form className="form modal__body" onSubmit={submit}>
          <div className="image-picker">
            <FoodImage key={preview ?? imageUrl ?? 'none'} src={preview ?? imageUrl} alt="Preview" className="image-picker__preview" />
            <div className="image-picker__actions">
              <label className="btn btn--ghost btn--sm">
                {preview || imageUrl ? 'Change photo' : 'Upload photo'}
                <input type="file" accept="image/*" hidden onChange={(e) => onPickFile(e.target.files?.[0])} />
              </label>
              {(preview || imageUrl) && (
                <button
                  type="button"
                  className="btn btn--text btn--sm"
                  onClick={() => {
                    setFile(null)
                    setImageUrl(null)
                  }}
                >
                  Remove
                </button>
              )}
              <small className="muted">JPG, PNG or WebP · max 5 MB</small>
            </div>
          </div>

          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </label>

          <label className="field">
            <span>Short description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={300} />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Price ({CURRENCY.symbol})</span>
              <input type="number" inputMode="decimal" min="0" step="50" value={price} onChange={(e) => setPrice(e.target.value)} required />
            </label>
            <label className="field">
              <span>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="field-row">
            <label className="switch-row">
              <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
              <span className="switch" aria-hidden="true" />
              <span>{available ? 'Available' : 'Sold out'}</span>
            </label>

            <label className="switch-row">
              <input type="checkbox" checked={bestSeller} onChange={(e) => setBestSeller(e.target.checked)} />
              <span className="switch" aria-hidden="true" />
              <span>House Favourite</span>
            </label>
          </div>

          {error && <p className="alert alert--error" role="alert">{error}</p>}

          <div className="modal__footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Saving…' : item ? 'Save changes' : 'Add item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}