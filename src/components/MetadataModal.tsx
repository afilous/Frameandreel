import { useState, useEffect, useRef } from "react";

// ═══════════════════════════════════════════════════════════
// Types - Batch Ingest Metadata
// ═══════════════════════════════════════════════════════════

export interface BatchMetadata {
  lotNumber: string;
  expectedEraStart: number;
  expectedEraEnd: number;
  posterCountry: string;
  posterFormat: string;
  batchNotes: string;
}

export interface PendingFiles {
  files: File[];
  folderName: string | null;
}

interface MetadataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (metadata: BatchMetadata) => void;
  pendingFiles: PendingFiles;
  lastUsed: {
    lotNumber: string;
    posterCountry: string;
    posterFormat: string;
  };
}

// Poster countries for searchable dropdown
const POSTER_COUNTRIES = [
  { value: "us", label: "United States", language: "en" },
  { value: "uk", label: "United Kingdom", language: "en" },
  { value: "france", label: "France", language: "fr" },
  { value: "italy", label: "Italy", language: "it" },
  { value: "germany", label: "Germany", language: "de" },
  { value: "spain", label: "Spain", language: "es" },
  { value: "japan", label: "Japan", language: "ja" },
  { value: "australia", label: "Australia", language: "en" },
  { value: "canada", label: "Canada", language: "en" },
  { value: "mexico", label: "Mexico", language: "es" },
  { value: "argentina", label: "Argentina", language: "es" },
  { value: "brazil", label: "Brazil", language: "pt" },
  { value: "sweden", label: "Sweden", language: "sv" },
  { value: "denmark", label: "Denmark", language: "da" },
  { value: "norway", label: "Norway", language: "no" },
  { value: "finland", label: "Finland", language: "fi" },
  { value: "netherlands", label: "Netherlands", language: "nl" },
  { value: "belgium", label: "Belgium", language: "nl" },
  { value: "portugal", label: "Portugal", language: "pt" },
  { value: "greece", label: "Greece", language: "el" },
  { value: "turkey", label: "Turkey", language: "tr" },
  { value: "india", label: "India", language: "hi" },
  { value: "south-korea", label: "South Korea", language: "ko" },
  { value: "china", label: "China", language: "zh" },
  { value: "hong-kong", label: "Hong Kong", language: "zh" },
  { value: "thailand", label: "Thailand", language: "th" },
  { value: "philippines", label: "Philippines", language: "tl" },
  { value: "indonesia", label: "Indonesia", language: "id" },
  { value: "poland", label: "Poland", language: "pl" },
  { value: "czech", label: "Czech Republic", language: "cs" },
  { value: "hungary", label: "Hungary", language: "hu" },
  { value: "romania", label: "Romania", language: "ro" },
  { value: "yugoslavia", label: "Yugoslavia", language: "sr" },
  { value: "soviet", label: "Soviet Union", language: "ru" },
];

// Poster formats with marketplace specs
const POSTER_FORMATS = [
  { value: "one-sheet", label: "One Sheet (27x41)", dimensions: "27x41 inches" },
  { value: "three-sheet", label: "Three Sheet (41x81)", dimensions: "41x81 inches" },
  { value: "six-sheet", label: "Six Sheet (81x81)", dimensions: "81x81 inches" },
  { value: "locandina", label: "Locandina (13x28)", dimensions: "13x28 inches (Italian)" },
  { value: "fotobusta", label: "Fotobusta (18x26)", dimensions: "18x26 inches (Italian)" },
  { value: "foglio", label: "Foglio (15x21)", dimensions: "15x21 inches (Italian)" },
  { value: "a", label: "A Size (24x33)", dimensions: "24x33 inches (Japanese)" },
  { value: "b", label: "B Size (29x41)", dimensions: "29x41 inches (Japanese)" },
  { value: "dvd", label: "DVD Cover (8.5x11)", dimensions: "8.5x11 inches" },
  { value: "half-sheet", label: "Half Sheet (14x22)", dimensions: "14x22 inches" },
  { value: "insert", label: "Insert (14x36)", dimensions: "14x36 inches" },
  { value: "window-card", label: "Window Card (22x28)", dimensions: "22x28 inches" },
  { value: "lobby-card", label: "Lobby Card (11x14)", dimensions: "11x14 inches" },
  { value: "teaser", label: "Teaser (22x16)", dimensions: "22x16 inches" },
  { value: "advance", label: "Advance (27x41)", dimensions: "27x41 inches" },
  { value: "original", label: "Original (varies)", dimensions: "Various" },
];

// Extract lot number from folder name using regex
function extractLotNumber(folderName: string | null): string {
  if (!folderName) return "";
  
  // Common patterns: Lot_7155315, lot-7155315, Lot7155315, 7155315
  const patterns = [
    /lot[_-]?(\d+)/i,
    /(\d{6,})/, // 6+ digit numbers
    /#(\d+)/,
  ];
  
  for (const pattern of patterns) {
    const match = folderName.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }
  
  return "";
}

// Era presets for quick selection
const ERA_PRESETS = [
  { label: "Silent Era", start: 1900, end: 1929 },
  { label: "Pre-Code", start: 1930, end: 1934 },
  { label: "Golden Age", start: 1935, end: 1949 },
  { label: "Post-War", start: 1950, end: 1959 },
  { label: "60s Revolution", start: 1960, end: 1969 },
  { label: "70s Blockbusters", start: 1970, end: 1979 },
  { label: "80s Home Video", start: 1980, end: 1989 },
  { label: "90s Revival", start: 1990, end: 1999 },
  { label: "Modern", start: 2000, end: 2025 },
];

export function MetadataModal({
  isOpen,
  onClose,
  onConfirm,
  pendingFiles,
  lastUsed,
}: MetadataModalProps) {
  const [lotNumber, setLotNumber] = useState("");
  const [expectedEraStart, setExpectedEraStart] = useState(1950);
  const [expectedEraEnd, setExpectedEraEnd] = useState(1959);
  const [posterCountry, setPosterCountry] = useState("");
  const [posterFormat, setPosterFormat] = useState("");
  const [batchNotes, setBatchNotes] = useState("");
  const [countrySearch, setCountrySearch] = useState("");
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [showFormatDropdown, setShowFormatDropdown] = useState(false);
  const countryInputRef = useRef<HTMLInputElement>(null);
  const formatInputRef = useRef<HTMLInputElement>(null);

  // Initialize from folder name and last used values
  useEffect(() => {
    if (isOpen) {
      const extractedLot = extractLotNumber(pendingFiles.folderName);
      setLotNumber(extractedLot || lastUsed.lotNumber);
      setPosterCountry(lastUsed.posterCountry);
      setPosterFormat(lastUsed.posterFormat);
      setCountrySearch("");
      setShowCountryDropdown(false);
      setShowFormatDropdown(false);
    }
  }, [isOpen, pendingFiles.folderName, lastUsed]);

  // Filter countries based on search
  const filteredCountries = POSTER_COUNTRIES.filter(
    (c) =>
      c.label.toLowerCase().includes(countrySearch.toLowerCase()) ||
      c.value.toLowerCase().includes(countrySearch.toLowerCase())
  );

  // Filter formats based on search
  const filteredFormats = POSTER_FORMATS.filter(
    (f) =>
      f.label.toLowerCase().includes(posterFormat.toLowerCase()) ||
      f.value.toLowerCase().includes(posterFormat.toLowerCase())
  );

  const handleConfirm = () => {
    onConfirm({
      lotNumber,
      expectedEraStart,
      expectedEraEnd,
      posterCountry,
      posterFormat,
      batchNotes,
    });
  };

  const handleEraPreset = (preset: typeof ERA_PRESETS[0]) => {
    setExpectedEraStart(preset.start);
    setExpectedEraEnd(preset.end);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#2C1810] border-2 border-[#C8A951] rounded-lg shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-[#8B1A1A] px-6 py-4 border-b border-[#C8A951]/30">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-serif text-[#F5F0E8]">
                📋 Batch Ingest Configuration
              </h2>
              <p className="text-sm text-[#F5F0E8]/70">
                Define the "DNA" of this batch before upload
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-[#F5F0E8]/60 hover:text-[#F5F0E8] text-2xl"
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* File Count Banner */}
          <div className="bg-[#C8A951]/10 border border-[#C8A951]/30 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">📁</span>
              <div>
                <p className="text-[#F5F0E8] font-medium">
                  {pendingFiles.files.length} file{pendingFiles.files.length !== 1 ? "s" : ""} pending
                </p>
                {pendingFiles.folderName && (
                  <p className="text-sm text-[#F5F0E8]/60">
                    Source: {pendingFiles.folderName}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Lot Number */}
          <div>
            <label className="block text-sm font-medium text-[#C8A951] mb-2">
              Lot Number <span className="text-[#F5F0E8]/50">(Primary CRM Filter)</span>
            </label>
            <input
              type="text"
              value={lotNumber}
              onChange={(e) => setLotNumber(e.target.value)}
              placeholder="e.g., 7155315"
              className="w-full px-4 py-3 bg-[#1a0f0a] border border-[#C8A951]/30 rounded-lg text-[#F5F0E8] placeholder-[#F5F0E8]/30 focus:border-[#C8A951] focus:outline-none font-mono"
            />
            <p className="text-xs text-[#F5F0E8]/50 mt-1">
              Extracted from folder name if available
            </p>
          </div>

          {/* Expected Era - Range Slider + Presets */}
          <div>
            <label className="block text-sm font-medium text-[#C8A951] mb-2">
              Expected Era <span className="text-[#F5F0E8]/50">(Triggers conflict if different)</span>
            </label>
            
            {/* Era Presets */}
            <div className="flex flex-wrap gap-2 mb-4">
              {ERA_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handleEraPreset(preset)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    expectedEraStart === preset.start && expectedEraEnd === preset.end
                      ? "bg-[#C8A951] text-[#2C1810] border-[#C8A951]"
                      : "bg-transparent text-[#F5F0E8]/70 border-[#C8A951]/30 hover:border-[#C8A951]"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Range Slider */}
            <div className="bg-[#1a0f0a] border border-[#C8A951]/30 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[#F5F0E8]">{expectedEraStart}</span>
                <span className="text-[#C8A951] font-medium">
                  {expectedEraEnd - expectedEraStart + 1} years
                </span>
                <span className="text-[#F5F0E8]">{expectedEraEnd}</span>
              </div>
              <div className="relative h-2 bg-[#F5F0E8]/20 rounded-full">
                <div
                  className="absolute h-full bg-gradient-to-r from-[#8B1A1A] to-[#C8A951] rounded-full"
                  style={{
                    left: `${((expectedEraStart - 1900) / 125) * 100}%`,
                    right: `${100 - ((expectedEraEnd - 1900) / 125) * 100}%`,
                  }}
                />
              </div>
              <input
                type="range"
                min={1900}
                max={2025}
                value={expectedEraStart}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (val <= expectedEraEnd) setExpectedEraStart(val);
                }}
                className="w-full mt-2 accent-[#C8A951]"
              />
              <input
                type="range"
                min={1900}
                max={2025}
                value={expectedEraEnd}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (val >= expectedEraStart) setExpectedEraEnd(val);
                }}
                className="w-full mt-2 accent-[#C8A951]"
              />
            </div>
          </div>

          {/* Poster Country - Searchable Dropdown */}
          <div className="relative">
            <label className="block text-sm font-medium text-[#C8A951] mb-2">
              Poster Country <span className="text-[#F5F0E8]/50">(Sets Language Priority for AI)</span>
            </label>
            <input
              ref={countryInputRef}
              type="text"
              value={posterCountry}
              onChange={(e) => {
                setPosterCountry(e.target.value);
                setCountrySearch(e.target.value);
                setShowCountryDropdown(true);
              }}
              onFocus={() => setShowCountryDropdown(true)}
              onBlur={() => setTimeout(() => setShowCountryDropdown(false), 200)}
              placeholder="Search countries..."
              className="w-full px-4 py-3 bg-[#1a0f0a] border border-[#C8A951]/30 rounded-lg text-[#F5F0E8] placeholder-[#F5F0E8]/30 focus:border-[#C8A951] focus:outline-none"
            />
            {showCountryDropdown && filteredCountries.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-[#1a0f0a] border border-[#C8A951]/30 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredCountries.map((country) => (
                  <button
                    key={country.value}
                    onClick={() => {
                      setPosterCountry(country.value);
                      setCountrySearch(country.label);
                      setShowCountryDropdown(false);
                    }}
                    className="w-full px-4 py-2 text-left text-[#F5F0E8] hover:bg-[#8B1A1A] flex justify-between items-center"
                  >
                    <span>{country.label}</span>
                    <span className="text-xs text-[#F5F0E8]/50">{country.language}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Poster Format - Searchable Dropdown */}
          <div className="relative">
            <label className="block text-sm font-medium text-[#C8A951] mb-2">
              Poster Format <span className="text-[#F5F0E8]/50">(Pre-fills marketplace specs)</span>
            </label>
            <input
              ref={formatInputRef}
              type="text"
              value={posterFormat}
              onChange={(e) => {
                setPosterFormat(e.target.value);
                setShowFormatDropdown(true);
              }}
              onFocus={() => setShowFormatDropdown(true)}
              onBlur={() => setTimeout(() => setShowFormatDropdown(false), 200)}
              placeholder="Search formats..."
              className="w-full px-4 py-3 bg-[#1a0f0a] border border-[#C8A951]/30 rounded-lg text-[#F5F0E8] placeholder-[#F5F0E8]/30 focus:border-[#C8A951] focus:outline-none"
            />
            {showFormatDropdown && filteredFormats.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-[#1a0f0a] border border-[#C8A951]/30 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredFormats.map((format) => (
                  <button
                    key={format.value}
                    onClick={() => {
                      setPosterFormat(format.value);
                      setShowFormatDropdown(false);
                    }}
                    className="w-full px-4 py-2 text-left text-[#F5F0E8] hover:bg-[#8B1A1A] flex justify-between items-center"
                  >
                    <span>{format.label}</span>
                    <span className="text-xs text-[#F5F0E8]/50">{format.dimensions}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Batch Notes */}
          <div>
            <label className="block text-sm font-medium text-[#C8A951] mb-2">
              Batch Notes <span className="text-[#F5F0E8]/50">(Injects provenance into all items)</span>
            </label>
            <textarea
              value={batchNotes}
              onChange={(e) => setBatchNotes(e.target.value)}
              placeholder="e.g., From the Estate of Mario Bianchi, Rome 2024"
              rows={3}
              className="w-full px-4 py-3 bg-[#1a0f0a] border border-[#C8A951]/30 rounded-lg text-[#F5F0E8] placeholder-[#F5F0E8]/30 focus:border-[#C8A951] focus:outline-none resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-[#1a0f0a] px-6 py-4 border-t border-[#C8A951]/30 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2 text-[#F5F0E8]/70 hover:text-[#F5F0E8] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-6 py-2 bg-[#C8A951] text-[#2C1810] rounded-lg font-medium hover:bg-[#d4b96a] transition-colors flex items-center gap-2"
          >
            <span>🚀</span>
            Confirm Ingest
          </button>
        </div>
      </div>
    </div>
  );
}

export { POSTER_COUNTRIES, POSTER_FORMATS, ERA_PRESETS };
