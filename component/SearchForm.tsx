import React, { useState } from 'react';

interface SearchFormProps {
  onSearch?: (searchTerm: string) => void;
  placeholder?: string;
}

const SearchForm: React.FC<SearchFormProps> = ({ onSearch, placeholder = '검색어를 입력하세요' }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSearch) {
      onSearch(searchTerm);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder={placeholder}
        className="px-3 py-2 border border-gray-300 rounded flex-1"
      />
      <button 
        type="submit"
        className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
      >
        검색
      </button>
    </form>
  );
};

export default SearchForm; 