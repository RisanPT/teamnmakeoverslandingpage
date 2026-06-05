import { useEffect, useMemo, useState } from 'react';
import teamNLogo from './assets/teamnlogo.png';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  `${window.location.protocol}//${window.location.hostname}:5001/api`;

const initialForm = {
  customerName: '',
  phone: '',
  address: '',
  pincode: '',
  email: '',
  districtId: '',
  regionId: '',
  packageId: '',
  eventSlot: '',
  selectedDates: [],
};

const EXTRA_DATE_AMOUNT = 3000;

function App() {
  const [packages, setPackages] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [blockedDates, setBlockedDates] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [cartItems, setCartItems] = useState([]);
  const totalPackageCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems],
  );

  useEffect(() => {
    let mounted = true;

    async function loadInitialData() {
      try {
        setLoading(true);
        setError('');

        const [packagesData, districtsData, bookingsData, blockedDatesData] =
          await Promise.all([
          fetchJson('/packages'),
          fetchJson('/districts?active=true'),
          fetchJson('/bookings/public'),
          fetchJson('/blocked-dates?active=true'),
        ]);

        if (!mounted) return;

        const normalizedPackages = dedupeById(packagesData, normalizePackage);
        const normalizedDistricts = dedupeById(districtsData, normalizeDistrict);
        const normalizedBookings = bookingsData.map(normalizeBooking);
        const normalizedBlockedDates = blockedDatesData.map(normalizeBlockedDate);

        setPackages(normalizedPackages);
        setDistricts(normalizedDistricts);
        setBookings(normalizedBookings);
        setBlockedDates(normalizedBlockedDates);
        setForm((prev) => ({
          ...prev,
          packageId: prev.packageId || normalizedPackages[0]?.id || '',
        }));
      } catch (loadError) {
        if (!mounted) return;
        setError(loadError.message || 'Failed to load booking setup.');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadInitialData();

    return () => {
      mounted = false;
    };
  }, []);

  const selectedPackage = useMemo(
    () => packages.find((item) => item.id === form.packageId) ?? null,
    [packages, form.packageId],
  );

  const selectedDistrict = useMemo(
    () => districts.find((item) => item.id === form.districtId) ?? null,
    [districts, form.districtId],
  );

  const bookingItems = useMemo(() => {
    const sortedSelectedDates = [...form.selectedDates].sort();

    return cartItems
      .flatMap((item) => {
        const packageDoc = packages.find((pkg) => pkg.id === item.packageId);
        if (!packageDoc) return [];

        let basePrice = packageDoc.price;
        if (form.districtId) {
          const distPrice = packageDoc.districtPrices?.find(
            (dp) => dp.districtId === form.districtId
          );
          if (distPrice) {
            basePrice = distPrice.price;
          } else if (form.regionId) {
            const regPrice = packageDoc.regionPrices?.find(
              (rp) => rp.regionId === form.regionId
            );
            if (regPrice) {
              basePrice = regPrice.price;
            }
          }
        } else if (form.regionId) {
          const regPrice = packageDoc.regionPrices?.find(
            (rp) => rp.regionId === form.regionId
          );
          if (regPrice) {
            basePrice = regPrice.price;
          }
        }

        return Array.from({ length: item.quantity }, () => ({
          packageId: packageDoc.id,
          service: packageDoc.name,
          eventSlot: item.eventSlot,
          selectedDates: sortedSelectedDates,
          totalPrice: basePrice,
          advanceAmount: packageDoc.advanceAmount ?? 3000,
        }));
      })
      .filter(Boolean);
  }, [cartItems, form.districtId, form.regionId, form.selectedDates, packages]);

  const basePackageAmount = useMemo(() => {
    return bookingItems.reduce((sum, item) => sum + item.totalPrice, 0);
  }, [bookingItems]);

  const extraDateCharge = useMemo(() => {
    return (
      Math.max(0, form.selectedDates.length - 1) *
      EXTRA_DATE_AMOUNT *
      Math.max(1, totalPackageCount)
    );
  }, [form.selectedDates.length, totalPackageCount]);

  const totalAmount = useMemo(() => {
    return basePackageAmount + extraDateCharge;
  }, [basePackageAmount, extraDateCharge]);

  const advanceAmount = useMemo(() => {
    return (
      bookingItems.reduce((sum, item) => sum + item.advanceAmount, 0) *
      form.selectedDates.length
    );
  }, [bookingItems, form.selectedDates.length]);

  const additionalPackageAdvance = useMemo(() => {
    return Math.max(0, totalPackageCount - 1) * 3000;
  }, [totalPackageCount]);

  const calendarDays = useMemo(
    () => buildCalendarDays(currentMonth, blockedDates),
    [currentMonth, blockedDates],
  );

  const onFieldChange = (field) => (event) => {
    const value = event.target.value;
    if (field === 'districtId') {
      const dist = districts.find((d) => d.id === value);
      const regionObj = dist?.region;
      const regionId = (typeof regionObj === 'object' && regionObj !== null)
        ? (regionObj._id ?? regionObj.id ?? '')
        : (regionObj ?? '');

      setForm((prev) => ({
        ...prev,
        districtId: value,
        regionId: regionId,
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        [field]: value,
      }));
    }
    setShowConfirmation(false);
  };

  const addPackageToCart = () => {
    if (!selectedPackage) {
      setError('Please select a package before adding it to the cart.');
      return;
    }

    setCartItems((prev) => {
      const normalizedSlot = form.eventSlot.trim();
      return [
        ...prev,
        {
          id: `${selectedPackage.id}-${Date.now()}-${prev.length}`,
          packageId: selectedPackage.id,
          eventSlot: normalizedSlot,
          quantity: 1,
        },
      ];
    });
    setForm((prev) => ({
      ...prev,
      eventSlot: '',
    }));
    setError('');
    setShowConfirmation(false);
  };

  const onCalendarDayClick = (day) => {
    if (day.isLocked) {
      setActiveTooltip((current) =>
        current?.value === day.value
          ? null
          : {
              value: day.value,
              message: day.lockMessage || 'This date is not available.',
            },
      );
      return;
    }

    setActiveTooltip(null);
    setForm((prev) => ({
      ...prev,
      selectedDates: prev.selectedDates.includes(day.value) ? [] : [day.value],
    }));
  };

  async function handleSubmit(event) {
    event.preventDefault();

    if (bookingItems.length === 0) {
      setError('Please add at least one package to the cart.');
      return;
    }

    if (!form.customerName.trim() || !form.phone.trim() || !form.email.trim() || !form.address.trim() || !form.pincode.trim()) {
      setError('Please complete the required personal details.');
      return;
    }

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }

    if (form.selectedDates.length === 0) {
      setError('Please choose at least one available event date.');
      return;
    }

    const sortedSelectedDates = [...form.selectedDates].sort();

    const payload = {
      customerName: form.customerName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      pincode: form.pincode.trim(),
      packageId: bookingItems[0].packageId,
      regionId: form.regionId ?? '',
      districtId: selectedDistrict?.id ?? '',
      service: bookingItems.map((item) => item.service).join(' + '),
      eventSlot: bookingItems
        .map((item) => item.eventSlot.trim())
        .filter(Boolean)
        .join(' | '),
      region: (typeof selectedDistrict?.region === 'object' && selectedDistrict?.region !== null)
        ? (selectedDistrict.region.name ?? '')
        : '',
      district: selectedDistrict?.name ?? '',
      selectedDates: sortedSelectedDates,
      bookingItems,
      status: 'pending',
      totalPrice: totalAmount,
      advanceAmount,
      discountAmount: 0,
      discountType: 'inr',
      discountValue: 0,
      assignedStaff: [],
      addons: [],
    };

    try {
      setSaving(true);
      setError('');

      const createdBooking = normalizeBooking(
        await fetchJson('/bookings/public', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      );

      setBookings((prev) => [createdBooking, ...prev]);
      setShowConfirmation(true);
    } catch (saveError) {
      setError(saveError.message || 'Failed to submit booking.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="booking-page-shell">
      <div className="luxury-blur blur-one" />
      <div className="luxury-blur blur-two" />
      <div className="luxury-blur blur-three" />

      <header className="page-header">
        <div className="brand">
          <div className="brand-icon">
            <img src={teamNLogo} alt="Team N Makeovers logo" />
          </div>
          <span className="brand-text">Team N Makeovers</span>
        </div>
      </header>

      <main className="page-main">
        <section className="hero-section">
          <div className="hero-pill">
            <ion-icon name="sparkles-outline" />
            Exclusive Experience
          </div>
          <h1>Book Your Makeover Session</h1>
          <p>
            Choose your package, select your event date, and confirm your
            request with advance payment. Prepare for a transformation that
            defines your best self.
          </p>
        </section>

        <section className="booking-card-shell">
          <div className="booking-card">
            {error ? <div className="notice-banner error">{error}</div> : null}

            {loading ? (
              <div className="loading-panel">
                Loading packages, regions, and live CRM availability...
              </div>
            ) : showConfirmation ? (
              <ConfirmationCard
                onBookAnother={() => {
                  setShowConfirmation(false);
                  setError('');
                  setCartItems([]);
                  setForm({
                    ...initialForm,
                    packageId: packages[0]?.id || '',
                  });
                }}
              />
            ) : (
              <form onSubmit={handleSubmit} className="booking-form">
                <BookingSection
                  icon="person-outline"
                  title="Personal Details"
                >
                  <div className="field-grid">
                    <Field
                      label="Full Name"
                      required
                      className="span-2"
                      value={form.customerName}
                      onChange={onFieldChange('customerName')}
                      placeholder="e.g. Alexandra Sterling"
                      icon="person-outline"
                    />
                    <Field
                      label="Phone Number"
                      required
                      type="tel"
                      value={form.phone}
                      onChange={onFieldChange('phone')}
                      placeholder="+91 98765 43210"
                      icon="call-outline"
                    />
                    <Field
                      label="Email Address"
                      required
                      type="email"
                      value={form.email}
                      onChange={onFieldChange('email')}
                      placeholder="alexandra@example.com"
                      icon="mail-outline"
                    />
                    <Field
                      label="Address"
                      required
                      className="span-2"
                      value={form.address}
                      onChange={onFieldChange('address')}
                      placeholder="Enter your address"
                      icon="home-outline"
                    />
                    <Field
                      label="Pincode"
                      required
                      value={form.pincode}
                      onChange={onFieldChange('pincode')}
                      placeholder="e.g. 600001"
                      icon="pin-outline"
                    />
                  </div>
                </BookingSection>

                <BookingSection
                  icon="location-outline"
                  title="Session Selection"
                >
                  <div className="field-grid">
                    <SelectField
                      label="Select Event Location"
                      required
                      value={form.districtId}
                      onChange={onFieldChange('districtId')}
                      icon="location-outline"
                      placeholder="Choose district"
                      options={districts.map((item) => ({
                        value: item.id,
                        label: item.name,
                      }))}
                    />
                    <div>
                      <SelectField
                        label="Select Package"
                        required
                        value={form.packageId}
                        onChange={onFieldChange('packageId')}
                        options={packages.map((item) => ({
                          value: item.id,
                          label: item.name,
                        }))}
                      />
                      <div className="helper-inline">
                        <ion-icon name="information-circle-outline" />
                        Add each package to the cart for this booking
                      </div>
                    </div>
                  </div>
                  <div className="field-grid">
                    <Field
                      label="Package Slot (Optional)"
                      value={form.eventSlot}
                      onChange={onFieldChange('eventSlot')}
                      placeholder="e.g. Morning Wedding"
                      icon="time-outline"
                    />
                    <div className="cart-action-shell">
                      <label className="field-label">Package Cart</label>
                      <button
                        type="button"
                        className="submit-button secondary-button"
                        onClick={addPackageToCart}
                      >
                        <span>Add Package</span>
                        <ion-icon name="add-outline" />
                      </button>
                    </div>
                  </div>
                  <div className="selected-date-pills">
                    {bookingItems.length > 0 ? (
                      cartItems.map((item, index) => {
                        const packageDoc = packages.find(
                          (pkg) => pkg.id === item.packageId,
                        );
                        return (
                          <span key={item.id ?? index} className="selected-date-pill">
                            {packageDoc?.name ?? 'Package'}
                            {item.eventSlot ? ` • ${item.eventSlot}` : ''}
                            <span className="pill-qty-controls">
                              <button
                                type="button"
                                className="pill-remove"
                                onClick={() =>
                                  setCartItems((prev) =>
                                    prev
                                      .map((cartItem) =>
                                        cartItem.id === item.id
                                          ? {
                                              ...cartItem,
                                              quantity: cartItem.quantity - 1,
                                            }
                                          : cartItem,
                                      )
                                      .filter((cartItem) => cartItem.quantity > 0),
                                  )
                                }
                              >
                                −
                              </button>
                              <span>{item.quantity}</span>
                              <button
                                type="button"
                                className="pill-remove"
                                onClick={() =>
                                  setCartItems((prev) =>
                                    prev.map((cartItem) =>
                                      cartItem.id === item.id
                                        ? {
                                            ...cartItem,
                                            quantity: cartItem.quantity + 1,
                                          }
                                        : cartItem,
                                    ),
                                  )
                                }
                              >
                                +
                              </button>
                            </span>
                          </span>
                        );
                      })
                    ) : (
                      <span className="selected-date-pill muted">
                        No packages added yet
                      </span>
                    )}
                  </div>
                </BookingSection>

                <BookingSection
                  icon="time-outline"
                  title="Date & Timing"
                >
                  <div className="calendar-layout">
                    <div>
                      <label className="field-label">Event Date</label>
                      <div className="calendar-card">
                        <div className="calendar-head">
                          <div className="calendar-month">
                            {formatMonthYear(currentMonth)}
                          </div>
                          <div className="calendar-nav">
                            <button
                              type="button"
                              className="calendar-nav-btn"
                              onClick={() =>
                                setCurrentMonth(addMonths(currentMonth, -1))
                              }
                            >
                              <ion-icon name="chevron-back-outline" />
                            </button>
                            <button
                              type="button"
                              className="calendar-nav-btn"
                              onClick={() =>
                                setCurrentMonth(addMonths(currentMonth, 1))
                              }
                            >
                              <ion-icon name="chevron-forward-outline" />
                            </button>
                          </div>
                        </div>

                        <div className="calendar-weekdays">
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(
                            (day) => (
                              <span key={day}>{day}</span>
                            ),
                          )}
                        </div>

                        <div className="calendar-grid">
                          {calendarDays.map((day) => {
                            const className = [
                              'calendar-day',
                              !day.isCurrentMonth ? 'outside' : '',
                              day.isLocked ? 'locked' : '',
                              form.selectedDates.includes(day.value)
                                ? 'selected'
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' ');

                            return (
                              <div
                                key={`${day.value}-${day.label}`}
                                className="calendar-day-wrap"
                                onMouseEnter={() => {
                                  if (!day.isLocked) return;
                                  setActiveTooltip({
                                    value: day.value,
                                    message: day.lockMessage,
                                  });
                                }}
                                onMouseLeave={() => {
                                  setActiveTooltip((current) =>
                                    current?.value === day.value ? null : current,
                                  );
                                }}
                              >
                                <button
                                  type="button"
                                  className={className}
                                  aria-disabled={day.isLocked}
                                  onClick={() => onCalendarDayClick(day)}
                                >
                                  {day.label}
                                </button>
                                {activeTooltip?.value === day.value ? (
                                  <div className="calendar-tooltip" role="tooltip">
                                    {activeTooltip.message}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>

                        <div className="calendar-hint">
                          <ion-icon name="information-circle-outline" />
                          Tap to select a date. Fully booked days are locked.
                        </div>
                      </div>

                      <div className="selected-date-pills">
                        {form.selectedDates.length > 0 ? (
                          form.selectedDates.map((selectedDate) => (
                            <span
                              key={selectedDate}
                              className="selected-date-pill"
                            >
                              {formatDate(new Date(`${selectedDate}T00:00:00`))}
                            </span>
                          ))
                        ) : (
                          <span className="selected-date-pill muted">
                            No date selected yet
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="timing-summary-column">
                      <div className="field-block">
                        <label className="field-label">Booking Status</label>
                        <div className="time-empty static-card">
                          {form.selectedDates.length > 0
                            ? 'Your selected date will be sent to our sales team. Exact timing will be confirmed by admin.'
                            : 'Select your preferred date. Timing will be coordinated by the admin team later.'}
                        </div>
                      </div>

                      <div className="summary-panel">
                        <div className="summary-row">
                          <span>Session Duration</span>
                          <strong>
                            {form.selectedDates.length || 0} Day
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Packages in Cart</span>
                          <strong>{totalPackageCount}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Preferred Date</span>
                          <strong>
                            {form.selectedDates.length > 0
                              ? 'Selected'
                              : 'Not selected'}
                          </strong>
                        </div>

                        <div className="advance-summary">
                          <div>
                            <div className="advance-title">
                              Advance to Confirm
                            </div>
                            <div className="advance-note">
                              Advance is charged per package for each selected date.
                            </div>
                          </div>
                          <div className="advance-amount">
                          <strong>₹{formatCurrency(advanceAmount)}</strong>
                          </div>
                        </div>
                        <div className="summary-footnote">
                          {form.selectedDates.length > 0 && bookingItems.length > 0
                            ? `${totalPackageCount} package${
                                totalPackageCount === 1 ? '' : 's'
                              } for the selected date. This booking needs ₹${formatCurrency(advanceAmount)} in advance to confirm.`
                            : 'Choose your date and add packages to see the confirmation advance.'}
                        </div>
                      </div>
                    </div>
                  </div>
                </BookingSection>

                <div className="form-footer">
                  <button
                    type="submit"
                    className="submit-button"
                    disabled={saving}
                  >
                    <span>
                      {saving
                        ? 'Submitting Booking Request...'
                        : 'Confirm & Pay Advance'}
                    </span>
                    <ion-icon name="chevron-forward-outline" />
                  </button>
                  <div className="checkout-note">
                    Secure 256-bit encrypted checkout
                  </div>
                </div>
              </form>
            )}
          </div>
        </section>

        <section className="trust-strip">
          <div className="trust-item">
            <ion-icon name="checkmark-circle-outline" />
            Certified Artist
          </div>
          <div className="trust-item">
            <ion-icon name="checkmark-circle-outline" />
            Premium Products
          </div>
          <div className="trust-item">
            <ion-icon name="checkmark-circle-outline" />
            Trusted Booking Flow
          </div>
        </section>
      </main>
    </div>
  );
}

function ConfirmationCard({ onBookAnother }) {
  return (
    <div className="confirmation-shell">
      <div className="confirmation-brand">
        <ion-icon name="sparkles-outline" />
        Team N Makeovers
      </div>

      <div className="confirmation-card">
        <div className="confirmation-glow" />
        <div className="confirmation-check">
          <ion-icon name="checkmark-outline" />
        </div>
        <h2>Booking Confirmed!</h2>
        <div className="confirmation-message">
          <ion-icon name="person-outline" />
          <p>Our sales team will reach out to you shortly.</p>
        </div>
        <button
          type="button"
          className="confirmation-secondary"
          onClick={onBookAnother}
        >
          Book Another Session
          <ion-icon name="chevron-forward-outline" />
        </button>
      </div>
    </div>
  );
}

function BookingSection({ icon, title, children }) {
  return (
    <section className="booking-section">
      <div className="section-heading">
        <div className="section-icon">
          <ion-icon name={icon} />
        </div>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  required = false,
  value,
  onChange,
  placeholder,
  icon,
  className = '',
  type = 'text',
}) {
  return (
    <div className={['field-group', className].filter(Boolean).join(' ')}>
      <label className="field-label">
        {label}
        {required ? ' *' : ''}
      </label>
      <div className="input-shell">
        {icon ? <ion-icon name={icon} /> : null}
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
        />
      </div>
    </div>
  );
}

function SelectField({
  label,
  required = false,
  value,
  onChange,
  options,
  icon,
  placeholder,
}) {
  return (
    <div className="field-group">
      <label className="field-label">
        {label}
        {required ? ' *' : ''}
      </label>
      <div className="input-shell select-shell">
        {icon ? <ion-icon name={icon} /> : null}
        <select value={value} onChange={onChange} required={required}>
          {placeholder ? (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={`${option.value}-${option.label}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ion-icon name="chevron-down-outline" />
      </div>
    </div>
  );
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null
        ? data.message || data.details || 'Request failed'
        : String(data);
    throw new Error(message);
  }

  return data;
}

function dedupeById(items, normalizer) {
  const seen = new Set();
  return items
    .map((item) => normalizer(item))
    .filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

function normalizeEntity(item) {
  return {
    ...item,
    id: item._id ?? item.id ?? '',
  };
}

function normalizeRegion(item) {
  return normalizeEntity(item);
}

function normalizeDistrict(item) {
  return normalizeEntity(item);
}

function normalizePackage(item) {
  const normalized = normalizeEntity(item);
  return {
    ...normalized,
    price: Number(normalized.price ?? 0),
    advanceAmount: Number(normalized.advanceAmount ?? 3000),
    regionPrices: (normalized.regionPrices ?? []).map((regionPrice) => {
      const region = regionPrice.region;
      return {
        ...regionPrice,
        regionId:
          (typeof region === 'object' && region !== null
            ? region._id ?? region.id
            : region) ??
          regionPrice.regionId ??
          '',
        price: Number(regionPrice.price ?? 0),
      };
    }),
    districtPrices: (normalized.districtPrices ?? []).map((districtPrice) => {
      const district = districtPrice.district;
      return {
        ...districtPrice,
        districtId:
          (typeof district === 'object' && district !== null
            ? district._id ?? district.id
            : district) ??
          districtPrice.districtId ??
          '',
        price: Number(districtPrice.price ?? 0),
      };
    }),
  };
}

function normalizeBooking(item) {
  return {
    ...item,
    id: item._id ?? item.id ?? '',
    address: item.address ?? '',
    pincode: item.pincode ?? '',
    bookingDate: item.bookingDate ?? item.serviceStart,
    selectedDates: item.selectedDates ?? [],
    serviceStart: item.serviceStart,
    serviceEnd: item.serviceEnd,
    bookingItems: (item.bookingItems ?? []).map((bookingItem) => ({
      ...bookingItem,
      packageId: bookingItem.packageId ?? '',
      service: bookingItem.service ?? '',
      eventSlot: bookingItem.eventSlot ?? '',
      selectedDates: bookingItem.selectedDates ?? [],
      totalPrice: Number(bookingItem.totalPrice ?? 0),
      advanceAmount: Number(bookingItem.advanceAmount ?? 0),
    })),
  };
}

function normalizeBlockedDate(item) {
  return {
    id: item._id ?? item.id ?? '',
    date: item.date,
    reason: item.reason ?? '',
    active: item.active ?? true,
  };
}

function isDateBlocked(date, blockedDates) {
  const key = stripTime(date);
  return blockedDates.some((item) => stripTime(new Date(item.date)) === key);
}

function getBlockedDateEntry(date, blockedDates) {
  const key = stripTime(date);
  return blockedDates.find((item) => stripTime(new Date(item.date)) === key) ?? null;
}

function buildCalendarDays(month, blockedDates) {
  const monthStart = startOfMonth(month);
  const firstWeekDay = monthStart.getDay();
  const calendarStart = addDays(monthStart, -firstWeekDay);

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(calendarStart, index);
    const isPast = stripTime(date) < stripTime(new Date());
    const blockedEntry = getBlockedDateEntry(date, blockedDates);
    const isLocked = isPast || Boolean(blockedEntry);

    return {
      value: toDateInputValue(date),
      label: date.getDate(),
      isCurrentMonth: date.getMonth() === month.getMonth(),
      isLocked,
      lockMessage: isPast
        ? 'This date has already passed and is no longer available.'
        : blockedEntry?.reason?.trim() || 'This date is not available for booking.',
    };
  });
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function addDays(date, amount) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function toDateInputValue(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatMonthYear(date) {
  return date.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
}

function formatDate(date) {
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export default App;
